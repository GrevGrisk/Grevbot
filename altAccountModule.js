const crypto = require("crypto");
const axios = require("axios");
const { EmbedBuilder } = require("discord.js");
const pool = require("./db");

const CF_BASE = "https://data.cftools.cloud";
const BAN_EVASION_WINDOW_HOURS = 3;

const recentBansBySteam64 = new Map();

function maskIP(ip) {
    if (!ip) return "Unknown";
    const parts = ip.split(".");
    if (parts.length !== 4) return "Hidden";
    return `${parts[0]}.${parts[1]}.xxx.xxx`;
}

function subnetIP(ip) {
    if (!ip) return null;
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
}

function hashIP(ip) {
    if (!process.env.IP_HASH_SECRET) {
        console.error("Missing IP_HASH_SECRET environment variable");
        return null;
    }

    return crypto
        .createHash("sha256")
        .update(ip + process.env.IP_HASH_SECRET)
        .digest("hex");
}

function cfProfileUrl(cftoolsId) {
    return cftoolsId
        ? `https://app.cftools.cloud/profile/${cftoolsId}`
        : null;
}

function playerLink(name, cftoolsId) {
    const safeName = name || "Unknown";
    const url = cfProfileUrl(cftoolsId);
    return url ? `[${safeName}](${url})` : safeName;
}

function idLink(id, cftoolsId) {
    if (!id) return "Unknown";
    const url = cfProfileUrl(cftoolsId);
    return url ? `[${id}](${url})` : id;
}

function formatDate(value) {
    if (!value) return "Unknown";
    return new Date(value).toISOString().split("T")[0];
}

function formatDateTime(value) {
    if (!value) return "Unknown";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return date.toISOString().replace("T", " ").split(".")[0] + " UTC";
}

function extractDayZHours(player) {
    const seconds =
        player?.info?.radar?.indicators?.playtime_total ||
        player?.radar?.indicators?.playtime_total ||
        player?.stats?.playtime ||
        player?.stats?.playtime_total ||
        player?.playtime ||
        player?.playtime_total ||
        player?.data?.info?.radar?.indicators?.playtime_total ||
        player?.data?.radar?.indicators?.playtime_total ||
        player?.data?.stats?.playtime ||
        player?.data?.stats?.playtime_total ||
        player?.data?.playtime ||
        player?.data?.playtime_total ||
        player?.player?.info?.radar?.indicators?.playtime_total ||
        player?.player?.radar?.indicators?.playtime_total ||
        player?.player?.stats?.playtime ||
        player?.player?.stats?.playtime_total ||
        player?.player?.playtime ||
        player?.player?.playtime_total ||
        0;

    return Math.round((Number(seconds || 0) / 3600) * 10) / 10;
}

async function getCFToolsToken() {
    const response = await axios.post(
        `${CF_BASE}/v1/auth/register`,
        {
            application_id: process.env.CFTOOLS_APP_ID,
            secret: process.env.CFTOOLS_APP_SECRET
        },
        {
            headers: {
                "User-Agent": process.env.CFTOOLS_APP_ID
            }
        }
    );

    return response.data.token;
}

async function getCFToolsGSMList() {
    const token = await getCFToolsToken();

    const response = await axios.get(
        `${CF_BASE}/v1/server/${process.env.CFTOOLS_SERVER_API_ID}/GSM/list`,
        {
            headers: {
                "User-Agent": process.env.CFTOOLS_APP_ID,
                "Authorization": `Bearer ${token}`
            }
        }
    );

    return response.data;
}

function normalizePlayers(list) {
    return Array.isArray(list)
        ? list
        : (list.sessions || list.players || list.data || []);
}

function parseBanExecutedMessage(content) {
    if (!content || !content.startsWith("BAN_EXECUTED")) return null;

    const parts = content.split("|").map(p => p.trim());
    const data = {};

    for (const part of parts) {
        if (part === "BAN_EXECUTED") continue;

        const index = part.indexOf("=");
        if (index === -1) continue;

        const key = part.slice(0, index).trim().toLowerCase();
        const value = part.slice(index + 1).trim();

        data[key] = value;
    }

    if (!data.steam64) return null;

    return {
        name: data.name || null,
        steam64: data.steam64,
        reason: data.reason || "Unknown"
    };
}

async function handleBanWebhookMessage(content) {
    const ban = parseBanExecutedMessage(content);
    if (!ban) return false;

    const marked = await markPlayerBannedBySteam64(ban.steam64, ban);

    console.log("BAN_EXECUTED parsed:", {
        name: ban.name,
        steam64: ban.steam64,
        reason: ban.reason,
        marked
    });

    return true;
}

async function getOrCreatePlayer(player) {
    const steam64 = player.steam64;
    const cftoolsId = player.cftools_id || null;
    const beguid = player.beguid || null;
    const name = player.player_name || null;
    const dayzHours = Number(player.dayz_hours || 0);

    const existing = await pool.query(`
        SELECT id FROM alt_players
        WHERE steam64 = $1
        LIMIT 1
    `, [steam64]);

    if (existing.rows.length > 0) {
        await pool.query(`
            UPDATE alt_players
            SET cftools_id = $1,
                beguid = $2,
                last_name = $3,
                dayz_hours = CASE WHEN $4 > 0 THEN $4 ELSE dayz_hours END
            WHERE id = $5
        `, [cftoolsId, beguid, name, dayzHours, existing.rows[0].id]);

        return existing.rows[0].id;
    }

    const created = await pool.query(`
        INSERT INTO alt_players
        (steam64, cftools_id, beguid, last_name, created_at, dayz_hours)
        VALUES ($1, $2, $3, $4, CURRENT_DATE, $5)
        RETURNING id
    `, [steam64, cftoolsId, beguid, name, dayzHours]);

    return created.rows[0].id;
}

async function findPreviousIpMatches(ipHash, steam64) {
    const result = await pool.query(`
        SELECT
            ap.id AS player_id,
            ap.steam64,
            ap.cftools_id,
            ap.beguid,
            ap.last_name,
            ail.ip_masked,
            ail.ip_subnet,
            ail.provider,
            ail.country_code,
            ail.country_name,
            ail.first_seen,
            ail.last_seen,
            ail.seen_count
        FROM alt_ip_links ail
        JOIN alt_players ap ON ap.id = ail.player_id
        WHERE ail.ip_hash = $1
          AND ap.steam64 != $2
        ORDER BY ail.last_seen DESC
    `, [ipHash, steam64]);

    return result.rows;
}

async function saveIpLink(playerId, ipHash, data) {
    const existing = await pool.query(`
        SELECT id FROM alt_ip_links
        WHERE player_id = $1
          AND ip_hash = $2
          AND server_id = $3
        LIMIT 1
    `, [
        playerId,
        ipHash,
        process.env.CFTOOLS_SERVER_API_ID
    ]);

    if (existing.rows.length > 0) {
        await pool.query(`
            UPDATE alt_ip_links
            SET last_seen = CURRENT_DATE,
                seen_count = seen_count + 1,
                ip_masked = $1,
                provider = $2,
                country_code = $3,
                country_name = $4,
                ip_subnet = $5
            WHERE id = $6
        `, [
            data.ip_masked,
            data.provider,
            data.country_code,
            data.country_name,
            data.ip_subnet,
            existing.rows[0].id
        ]);
    } else {
        await pool.query(`
            INSERT INTO alt_ip_links
            (
                player_id,
                ip_hash,
                server_id,
                first_seen,
                last_seen,
                seen_count,
                ip_masked,
                provider,
                country_code,
                country_name,
                ip_subnet,
                banned_player
            )
            VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE, 1, $4, $5, $6, $7, $8, false)
        `, [
            playerId,
            ipHash,
            process.env.CFTOOLS_SERVER_API_ID,
            data.ip_masked,
            data.provider,
            data.country_code,
            data.country_name,
            data.ip_subnet
        ]);
    }
}

async function altCaseExists(currentPlayerId, matchedPlayerId, reason = "Shared IP") {
    const result = await pool.query(`
        SELECT id FROM alt_cases
        WHERE (
            (player_id = $1 AND matched_player_id = $2)
            OR
            (player_id = $2 AND matched_player_id = $1)
        )
        AND reason = $3
        LIMIT 1
    `, [currentPlayerId, matchedPlayerId, reason]);

    return result.rows.length > 0;
}

async function createAltCase(currentPlayerId, matchedPlayerId, reason = "Shared IP", score = 90) {
    await pool.query(`
        INSERT INTO alt_cases
        (player_id, matched_player_id, score, reason, created_at)
        VALUES ($1, $2, $3, $4, CURRENT_DATE)
    `, [
        currentPlayerId,
        matchedPlayerId,
        score,
        reason
    ]);
}

async function markPlayerBannedBySteam64(steam64, banData = {}) {
    const player = await pool.query(`
        SELECT id FROM alt_players
        WHERE steam64 = $1
        LIMIT 1
    `, [steam64]);

    recentBansBySteam64.set(steam64, {
        timestamp: Date.now(),
        reason: banData.reason || "Unknown",
        name: banData.name || null
    });

    if (player.rows.length === 0) {
        console.log("BAN_EXECUTED player not found in alt_players yet:", steam64);
        return false;
    }

    await pool.query(`
        UPDATE alt_ip_links
        SET banned_player = true,
            last_ban_seen = CURRENT_DATE
        WHERE player_id = $1
    `, [player.rows[0].id]);

    return true;
}

function isRecentBan(steam64) {
    const ban = recentBansBySteam64.get(steam64);
    if (!ban) return false;

    const ageMs = Date.now() - ban.timestamp;
    return ageMs <= BAN_EVASION_WINDOW_HOURS * 60 * 60 * 1000;
}

function getRecentBanInfo(steam64) {
    return recentBansBySteam64.get(steam64) || null;
}

function cleanupRecentBans() {
    for (const [steam64, ban] of recentBansBySteam64.entries()) {
        const ageMs = Date.now() - ban.timestamp;
        if (ageMs > BAN_EVASION_WINDOW_HOURS * 60 * 60 * 1000) {
            recentBansBySteam64.delete(steam64);
        }
    }
}

async function findSubnetBanEvasionMatches(data) {
    if (!data.ip_subnet || !data.provider) return [];

    cleanupRecentBans();

    const result = await pool.query(`
        SELECT
            ap.id AS player_id,
            ap.steam64,
            ap.cftools_id,
            ap.beguid,
            ap.last_name,
            ail.ip_masked,
            ail.ip_subnet,
            ail.provider,
            ail.country_code,
            ail.country_name,
            ail.first_seen,
            ail.last_seen,
            ail.seen_count,
            ail.last_ban_seen,
            ail.banned_player
        FROM alt_ip_links ail
        JOIN alt_players ap ON ap.id = ail.player_id
        WHERE ail.ip_subnet = $1
          AND LOWER(ail.provider) = LOWER($2)
          AND ap.steam64 != $3
          AND ail.banned_player = true
        ORDER BY ail.last_seen DESC
    `, [
        data.ip_subnet,
        data.provider,
        data.steam64
    ]);

    return result.rows.filter(row => isRecentBan(row.steam64));
}

function buildAltAlertEmbed(current, matches) {
    const matchedAccounts = Array.isArray(matches) ? matches : [matches];
    const limitedMatches = matchedAccounts.slice(0, 10);

    const matchedValue = limitedMatches.map((match, index) =>
        `🕵️ **${match.last_name || "Unknown"}**\n` +
        `🎮 **Name:** ${playerLink(match.last_name, match.cftools_id)}\n` +
        `🆔 **CFTools:** ${idLink(match.cftools_id, match.cftools_id)}\n` +
        `🔗 **Steam64:** ${idLink(match.steam64, match.cftools_id)}\n` +
        `🌐 **IP:** \`${match.ip_masked || current.ip_masked}\`\n` +
        `🏢 **Provider:** ${match.provider || current.provider || "Unknown"}\n` +
        `📍 **Country:** ${match.country_name || match.country_code || current.country_name || "Unknown"}\n` +
        `📅 **First Seen:** ${formatDate(match.first_seen)}\n` +
        `📈 **Times Seen:** ${match.seen_count || 1}` +
        (index < limitedMatches.length - 1 ? "\n\n" : "")
    ).join("");

    const embed = new EmbedBuilder()
        .setTitle("🚨 GrevBot Alt Account Detection")
        .setColor(0xff0000)
        .setDescription("**Possible alt account detected**\nShared IP found between this player and one or more stored accounts.")
        .addFields(
            {
                name: "👤 Current Player",
                value:
                    `🎮 **Name:** ${playerLink(current.player_name, current.cftools_id)}\n` +
                    `🆔 **CFTools:** ${idLink(current.cftools_id, current.cftools_id)}\n` +
                    `🔗 **Steam64:** ${idLink(current.steam64, current.cftools_id)}\n` +
                    `🌐 **IP:** \`${current.ip_masked}\`\n` +
                    `🏢 **Provider:** ${current.provider || "Unknown"}\n` +
                    `📍 **Country:** ${current.country_name || current.country_code || "Unknown"}`,
                inline: true
            },
            {
                name: matchedAccounts.length === 1 ? "🕵️ Matched Account" : "🕵️ Matched Accounts",
                value: matchedValue || "Unknown",
                inline: true
            },
            {
                name: "📊 Match Details",
                value:
                    `⚠️ **Type:** Shared IP\n` +
                    `🔥 **Confidence:** HIGH\n` +
                    `📈 **Matches Found:** ${matchedAccounts.length}`,
                inline: false
            }
        );

    if (matchedAccounts.length > limitedMatches.length) {
        embed.addFields({
            name: "➕ More Matches",
            value: `${matchedAccounts.length - limitedMatches.length} additional matches hidden to stay within Discord embed limits.`,
            inline: false
        });
    }

    return embed
        .setFooter({ text: "GrevBot • Alt account detection" })
        .setTimestamp();
}

function buildSubnetBanEvasionEmbed(current, matched) {
    const banInfo = getRecentBanInfo(matched.steam64);

    return new EmbedBuilder()
        .setTitle("🟡 Possible Ban Evasion Pattern")
        .setColor(0xffcc00)
        .setDescription("**A player joined shortly after a banned account used a similar IP range and same provider.**")
        .addFields(
            {
                name: "👤 Current Player",
                value:
                    `🎮 **Name:** ${playerLink(current.player_name, current.cftools_id)}\n` +
                    `🆔 **CFTools:** ${idLink(current.cftools_id, current.cftools_id)}\n` +
                    `🔗 **Steam64:** ${idLink(current.steam64, current.cftools_id)}\n` +
                    `🌐 **IP Range:** \`${current.ip_subnet || current.ip_masked}\`\n` +
                    `🏢 **Provider:** ${current.provider || "Unknown"}\n` +
                    `📍 **Country:** ${current.country_name || current.country_code || "Unknown"}`,
                inline: true
            },
            {
                name: "🚫 Recently Banned Account",
                value:
                    `🎮 **Name:** ${playerLink(matched.last_name || banInfo?.name, matched.cftools_id)}\n` +
                    `🆔 **CFTools:** ${idLink(matched.cftools_id, matched.cftools_id)}\n` +
                    `🔗 **Steam64:** ${idLink(matched.steam64, matched.cftools_id)}\n` +
                    `🌐 **Previous IP Range:** \`${matched.ip_subnet || matched.ip_masked}\`\n` +
                    `🏢 **Provider:** ${matched.provider || "Unknown"}\n` +
                    `📍 **Country:** ${matched.country_name || matched.country_code || "Unknown"}`,
                inline: true
            },
            {
                name: "📊 Match Details",
                value:
                    `⚠️ **Type:** Same provider + same /24 IP range\n` +
                    `⏱️ **Ban Window:** Within ${BAN_EVASION_WINDOW_HOURS} hours\n` +
                    `🔥 **Confidence:** MEDIUM / HIGH\n` +
                    `🚫 **Ban Seen:** ${banInfo ? formatDateTime(banInfo.timestamp) : formatDateTime(matched.last_ban_seen)}\n` +
                    `📝 **Ban Reason:** ${banInfo?.reason || "Unknown"}\n` +
                    `📈 **Previous IP Times Seen:** ${matched.seen_count || 1}`,
                inline: false
            }
        )
        .setFooter({ text: "GrevBot • Ban evasion pattern detection" })
        .setTimestamp();
}

async function sendAltAlert(client, current, matches) {
    const channelId = process.env.ALT_ALERT_CHANNEL_ID || "1508534144286589132";

    let channel;
    try {
        channel = await client.channels.fetch(channelId);
    } catch (err) {
        console.error("Alt alert channel fetch failed:", err);
        return;
    }

    if (!channel) return;

    const embed = buildAltAlertEmbed(current, matches);
    await channel.send({ embeds: [embed] });
}

async function sendSubnetBanEvasionAlert(client, current, matched) {
    const channelId = process.env.ALT_ALERT_CHANNEL_ID || "1508534144286589132";

    let channel;
    try {
        channel = await client.channels.fetch(channelId);
    } catch (err) {
        console.error("Subnet ban evasion channel fetch failed:", err);
        return;
    }

    if (!channel) return;

    const embed = buildSubnetBanEvasionEmbed(current, matched);
    await channel.send({ embeds: [embed] });
}

async function sendTestAltAlert(client) {
    const channelId = process.env.ALT_ALERT_CHANNEL_ID || "1508534144286589132";
    const channel = await client.channels.fetch(channelId);

    const current = {
        player_name: "BillyBOB",
        cftools_id: "6489fd3e8eabcc78746ab6fd",
        steam64: "76561198000000001",
        ip_masked: "37.166.xxx.xxx",
        provider: "Free Mobile SAS",
        country_name: "France"
    };

    const matched = {
        last_name: "SneakyAlt",
        cftools_id: "6489fd3e8eabcc78746ab111",
        steam64: "76561198000000099",
        ip_masked: "37.166.xxx.xxx",
        provider: "Free Mobile SAS",
        country_name: "France",
        first_seen: "2026-05-25",
        seen_count: 14
    };

    const embed = buildAltAlertEmbed(current, matched);
    await channel.send({ embeds: [embed] });
}

async function manualAltCheck(cftoolsId) {
    const playerResult = await pool.query(`
        SELECT id, steam64, cftools_id, beguid, last_name
        FROM alt_players
        WHERE cftools_id = $1
        LIMIT 1
    `, [cftoolsId]);

    if (playerResult.rows.length === 0) {
        return {
            found: false,
            embeds: [
                new EmbedBuilder()
                    .setTitle("🔍 GrevBot Manual Alt Check")
                    .setColor(0xff9900)
                    .setDescription("⚠️ No stored player found for that CFTools ID.")
                    .setFooter({ text: "GrevBot • Manual alt check" })
                    .setTimestamp()
            ]
        };
    }

    const player = playerResult.rows[0];

    const matchesResult = await pool.query(`
        SELECT DISTINCT
            ap.id AS player_id,
            ap.steam64,
            ap.cftools_id,
            ap.beguid,
            ap.last_name,
            ail.ip_masked,
            ail.ip_subnet,
            ail.provider,
            ail.country_code,
            ail.country_name,
            ail.first_seen,
            ail.last_seen,
            ail.seen_count
        FROM alt_ip_links source_ip
        JOIN alt_ip_links ail ON ail.ip_hash = source_ip.ip_hash
        JOIN alt_players ap ON ap.id = ail.player_id
        WHERE source_ip.player_id = $1
          AND ap.id != $1
        ORDER BY ail.last_seen DESC
    `, [player.id]);

    const matches = matchesResult.rows;

    if (matches.length === 0) {
        return {
            found: true,
            embeds: [
                new EmbedBuilder()
                    .setTitle("🔍 GrevBot Manual Alt Check")
                    .setColor(0x00aa00)
                    .setDescription("✅ No linked alt accounts found by shared IP.")
                    .addFields({
                        name: "👤 Checked Player",
                        value:
                            `🎮 **Name:** ${playerLink(player.last_name, player.cftools_id)}\n` +
                            `🆔 **CFTools:** ${idLink(player.cftools_id, player.cftools_id)}\n` +
                            `🔗 **Steam64:** ${idLink(player.steam64, player.cftools_id)}`,
                        inline: false
                    })
                    .setFooter({ text: "GrevBot • Manual alt check" })
                    .setTimestamp()
            ]
        };
    }

    const embed = new EmbedBuilder()
        .setTitle("🚨 GrevBot Manual Alt Check")
        .setColor(0xff0000)
        .setDescription("Possible alt accounts found through shared IP history.")
        .addFields(
            {
                name: "👤 Checked Player",
                value:
                    `🎮 **Name:** ${playerLink(player.last_name, player.cftools_id)}\n` +
                    `🆔 **CFTools:** ${idLink(player.cftools_id, player.cftools_id)}\n` +
                    `🔗 **Steam64:** ${idLink(player.steam64, player.cftools_id)}`,
                inline: false
            },
            {
                name: "📊 Match Summary",
                value:
                    `⚠️ **Type:** Shared IP\n` +
                    `🔥 **Confidence:** HIGH\n` +
                    `📈 **Matches Found:** ${matches.length}`,
                inline: false
            }
        )
        .setFooter({ text: "GrevBot • Manual alt check" })
        .setTimestamp();

    const limitedMatches = matches.slice(0, 10);

    for (const match of limitedMatches) {
        embed.addFields({
            name: `🕵️ ${match.last_name || "Unknown"}`,
            value:
                `🎮 **Name:** ${playerLink(match.last_name, match.cftools_id)}\n` +
                `🆔 **CFTools:** ${idLink(match.cftools_id, match.cftools_id)}\n` +
                `🔗 **Steam64:** ${idLink(match.steam64, match.cftools_id)}\n` +
                `🌐 **IP:** \`${match.ip_masked || "Hidden"}\`\n` +
                `🏢 **Provider:** ${match.provider || "Unknown"}\n` +
                `📍 **Country:** ${match.country_name || match.country_code || "Unknown"}\n` +
                `📅 **First Seen:** ${formatDate(match.first_seen)}\n` +
                `📈 **Times Seen:** ${match.seen_count || 1}`,
            inline: true
        });
    }

    if (matches.length > 10) {
        embed.addFields({
            name: "➕ More Matches",
            value: `${matches.length - 10} additional matches hidden.`,
            inline: false
        });
    }

    return {
        found: true,
        embeds: [embed]
    };
}

async function syncAndDetect(client) {
    const list = await getCFToolsGSMList();
    const players = normalizePlayers(list);

    let found = 0;
    let saved = 0;
    let alerts = 0;
    let subnetAlerts = 0;
    let skipped = 0;

    for (const p of players) {
        const steam64 = p?.gamedata?.steam64;
        const ip = p?.connection?.ipv4;

        if (!steam64 || !ip) {
            skipped++;
            continue;
        }

        found++;

        const current = {
            steam64,
            cftools_id: p?.cftools_id || null,
            beguid: p?.gamedata?.beguid || p?.gamedata?.be_guid || null,
            player_name: p?.gamedata?.player_name || p?.persona?.profile?.name || "Unknown",
            dayz_hours: extractDayZHours(p),
            ip,
            ip_masked: maskIP(ip),
            ip_subnet: subnetIP(ip),
            provider: p?.connection?.provider || "Unknown",
            country_code: p?.connection?.country_code || null,
            country_name: p?.connection?.country_names?.en || p?.connection?.country_code || "Unknown"
        };

        const ipHash = hashIP(ip);
        if (!ipHash) {
            skipped++;
            continue;
        }

        const previousMatches = await findPreviousIpMatches(ipHash, steam64);
        const subnetMatches = await findSubnetBanEvasionMatches(current);
        const currentPlayerId = await getOrCreatePlayer(current);

        await saveIpLink(currentPlayerId, ipHash, current);
        saved++;

        const newPreviousMatches = [];

        for (const matched of previousMatches) {
            const exists = await altCaseExists(currentPlayerId, matched.player_id, "Shared IP");
            if (exists) continue;

            await createAltCase(currentPlayerId, matched.player_id, "Shared IP", 90);
            newPreviousMatches.push(matched);
            alerts++;
        }

        if (newPreviousMatches.length > 0) {
            await sendAltAlert(client, current, newPreviousMatches);
        }

        for (const matched of subnetMatches) {
            const exists = await altCaseExists(currentPlayerId, matched.player_id, "Subnet ban evasion pattern");
            if (exists) continue;

            await createAltCase(currentPlayerId, matched.player_id, "Subnet ban evasion pattern", 70);
            await sendSubnetBanEvasionAlert(client, current, matched);
            subnetAlerts++;
        }
    }

    return { found, saved, alerts, subnetAlerts, skipped };
}

module.exports = {
    syncAndDetect,
    getCFToolsGSMList,
    sendTestAltAlert,
    manualAltCheck,
    handleBanWebhookMessage,
    markPlayerBannedBySteam64
};
