const crypto = require("crypto");
const axios = require("axios");
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");
const pool = require("./db");

const CF_BASE = "https://data.cftools.cloud";
const STEAM_API_BASE = "https://api.steampowered.com";
const BAN_EVASION_WINDOW_HOURS = 3;
const FRESH_STEAM_ACCOUNT_DAYS = 30;
const LOW_DAYZ_HOURS = Number(process.env.PLAYER_INTEL_LOW_HOURS || 50);
const RISK_ALERT_SCORE = Number(process.env.PLAYER_INTEL_RISK_SCORE || 70);

const recentBansBySteam64 = new Map();
const mutedPlayerIntelAlerts = new Set();

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

function normalizeDateValue(value) {
    if (!value) return null;

    if (typeof value === "number" || /^\d+$/.test(String(value))) {
        const numeric = Number(value);
        const ms = numeric > 9999999999 ? numeric : numeric * 1000;
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function getSteamAccountCreated(steam64) {
    if (!steam64 || !process.env.STEAM_API_KEY) return null;

    try {
        const response = await axios.get(
            `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/`,
            {
                params: {
                    key: process.env.STEAM_API_KEY,
                    steamids: steam64
                }
            }
        );

        const player = response.data?.response?.players?.[0];

        return player?.timecreated
            ? new Date(Number(player.timecreated) * 1000).toISOString()
            : null;
    } catch (err) {
        console.error("Steam API timecreated fetch error:", err.response?.data || err.message || err);
        return null;
    }
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
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return date.toISOString().split("T")[0];
}

function formatDateTime(value) {
    if (!value) return "Unknown";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return date.toISOString().replace("T", " ").split(".")[0] + " UTC";
}

function daysSince(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function extractSteamCreated(player) {
    return normalizeDateValue(
        player?.persona?.profile?.timecreated ||
        player?.profile?.timecreated ||
        player?.steam_created ||
        player?.steam_timecreated ||
        player?.steam?.timecreated ||
        player?.persona?.steam?.timecreated ||
        player?.persona?.profile?.steam_created ||
        player?.persona?.profile?.steam_timecreated ||
        player?.data?.persona?.profile?.timecreated ||
        player?.data?.profile?.timecreated ||
        player?.data?.steam?.timecreated ||
        player?.player?.persona?.profile?.timecreated ||
        player?.player?.profile?.timecreated ||
        player?.player?.steam?.timecreated ||
        null
    );
}

function extractDayZHours(player) {
    const seconds =
        player?.info?.radar?.indicators?.playtime_total ||
        player?.radar?.indicators?.playtime_total ||
        player?.stats?.playtime ||
        player?.playtime ||
        player?.data?.playtime ||
        player?.player?.playtime ||
        0;

    return Math.round((Number(seconds || 0) / 3600) * 10) / 10;
}

function extractPreviousBans(player) {
    return Number(
        player?.info?.ban_count ||
        player?.ban_count ||
        player?.data?.info?.ban_count ||
        player?.player?.info?.ban_count ||
        0
    );
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

function normalizeBanResponse(data) {
    if (Array.isArray(data)) return data;
    return data?.bans || data?.data || data?.entries || data?.results || [];
}

async function checkBanlistsForCftoolsId(cftoolsId) {
    const token = await getCFToolsToken();

    const banlists = [
        process.env.CFTOOLS_BANLIST_ID_1,
        process.env.CFTOOLS_BANLIST_ID_2
    ].filter(Boolean);

    const results = [];

    for (const banlistId of banlists) {
        try {
            const response = await axios.get(
                `${CF_BASE}/v1/banlist/${banlistId}/bans`,
                {
                    headers: {
                        "User-Agent": process.env.CFTOOLS_APP_ID,
                        "Authorization": `Bearer ${token}`
                    },
                    params: {
                        filter: cftoolsId
                    }
                }
            );

            const bans = normalizeBanResponse(response.data);

            results.push({
                banlistId,
                ok: true,
                count: bans.length,
                bans,
                rawKeys: response.data && typeof response.data === "object" ? Object.keys(response.data) : []
            });
        } catch (err) {
            results.push({
                banlistId,
                ok: false,
                count: 0,
                error: err.response?.data || err.message || err
            });
        }
    }

    const totalBans = results.reduce((sum, item) => sum + item.count, 0);

    if (totalBans > 0) {
        await markPlayerBannedByCFToolsId(cftoolsId);
    }

    return {
        cftoolsId,
        totalBans,
        results
    };
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
    const steamCreated = player.steam_created || null;
    const dayzHours = player.dayz_hours || 0;
    const previousBans = player.previous_bans || 0;

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
                steam_created = COALESCE($4, steam_created),
                dayz_hours = $5,
                previous_bans = $6
            WHERE id = $7
        `, [
            cftoolsId,
            beguid,
            name,
            steamCreated,
            dayzHours,
            previousBans,
            existing.rows[0].id
        ]);

        return existing.rows[0].id;
    }

    const created = await pool.query(`
        INSERT INTO alt_players
        (steam64, cftools_id, beguid, last_name, created_at, steam_created, dayz_hours, previous_bans)
        VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7)
        RETURNING id
    `, [
        steam64,
        cftoolsId,
        beguid,
        name,
        steamCreated,
        dayzHours,
        previousBans
    ]);

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

async function markPlayerBannedByCFToolsId(cftoolsId) {
    const player = await pool.query(`
        SELECT id, steam64 FROM alt_players
        WHERE cftools_id = $1
        LIMIT 1
    `, [cftoolsId]);

    if (player.rows.length === 0) {
        return false;
    }

    recentBansBySteam64.set(player.rows[0].steam64, {
        timestamp: Date.now(),
        reason: "Banlist match",
        name: null
    });

    await pool.query(`
        UPDATE alt_ip_links
        SET banned_player = true,
            last_ban_seen = CURRENT_DATE
        WHERE player_id = $1
    `, [player.rows[0].id]);

    return true;
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

function calculateRisk(current) {
    const accountAgeDays = daysSince(current.steam_created);
    let score = 0;
    const reasons = [];

    if (current.previous_bans > 0) {
        score += Math.min(50, current.previous_bans * 25);
        reasons.push(`Previous bans: ${current.previous_bans}`);
    }

    if (current.dayz_hours > 0 && current.dayz_hours < LOW_DAYZ_HOURS) {
        score += 25;
        reasons.push(`Low DayZ hours: ${current.dayz_hours}`);
    }

    if (accountAgeDays !== null && accountAgeDays >= 0 && accountAgeDays < FRESH_STEAM_ACCOUNT_DAYS) {
        score += 35;
        reasons.push(`Fresh Steam account: ${accountAgeDays} days old`);
    }

    if (current.provider && /vpn|proxy|hosting|datacenter|m247|ovh|digitalocean|hetzner|leaseweb/i.test(current.provider)) {
        score += 15;
        reasons.push(`Suspicious provider: ${current.provider}`);
    }

    return {
        score: Math.min(score, 100),
        reasons,
        accountAgeDays
    };
}

function shouldSendPlayerIntelAlert(type, steam64) {
    return !mutedPlayerIntelAlerts.has(`${type}:${steam64}`);
}

function playerIntelButtons(type, steam64, muted = false) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`playerintel_${muted ? "reactivate" : "deactivate"}_${type}_${steam64}`)
                .setLabel(muted ? "Reactivate Alert" : "Deactivate Alert")
                .setStyle(muted ? ButtonStyle.Success : ButtonStyle.Danger)
        )
    ];
}

function buildPlayerIntelEmbed(type, current, risk = null) {
    const titles = {
        previous_bans: "🚫 Player Intel: Previous Bans",
        low_hours: "⏱️ Player Intel: Low DayZ Hours",
        fresh_account: "🆕 Player Intel: Fresh Steam Account",
        risk_analysis: "⚠️ Player Intel: Risk Analysis"
    };

    const colors = {
        previous_bans: 0xff0000,
        low_hours: 0xff9900,
        fresh_account: 0xffcc00,
        risk_analysis: 0xff0000
    };

    const accountAgeDays = daysSince(current.steam_created);

    const embed = new EmbedBuilder()
        .setTitle(titles[type] || "⚠️ Player Intel Alert")
        .setColor(colors[type] || 0xff9900)
        .setDescription(`Player Intel triggered for ${playerLink(current.player_name, current.cftools_id)}.`)
        .addFields(
            {
                name: "👤 Player",
                value:
                    `🎮 **Name:** ${playerLink(current.player_name, current.cftools_id)}\n` +
                    `🆔 **CFTools:** ${idLink(current.cftools_id, current.cftools_id)}\n` +
                    `🔗 **Steam64:** ${idLink(current.steam64, current.cftools_id)}\n` +
                    `🌐 **IP:** \`${current.ip_masked || "Hidden"}\`\n` +
                    `🏢 **Provider:** ${current.provider || "Unknown"}\n` +
                    `📍 **Country:** ${current.country_name || current.country_code || "Unknown"}`,
                inline: false
            },
            {
                name: "🧠 Intel",
                value:
                    `📅 **Steam account created:** ${formatDate(current.steam_created)}${accountAgeDays !== null ? ` (${accountAgeDays} days old)` : ""}\n` +
                    `⏱️ **DayZ hours:** ${current.dayz_hours ?? 0}\n` +
                    `🚫 **Previous bans:** ${current.previous_bans ?? 0}`,
                inline: false
            }
        )
        .setFooter({ text: "GrevBot • Player Intel" })
        .setTimestamp();

    if (type === "risk_analysis" && risk) {
        embed.addFields({
            name: "📊 Risk Analysis",
            value:
                `🔥 **Risk Score:** ${risk.score}/100\n` +
                `⚠️ **Reasons:** ${risk.reasons.length ? risk.reasons.join(" | ") : "None"}`,
            inline: false
        });
    }

    return embed;
}

async function sendPlayerIntelAlert(client, type, current, risk = null) {
    if (!shouldSendPlayerIntelAlert(type, current.steam64)) return false;

    const channelId = process.env.PLAYER_INTEL_CHANNEL_ID || process.env.ALT_ALERT_CHANNEL_ID || "1508534144286589132";

    let channel;
    try {
        channel = await client.channels.fetch(channelId);
    } catch (err) {
        console.error("Player Intel alert channel fetch failed:", err);
        return false;
    }

    if (!channel) return false;

    await channel.send({
        embeds: [buildPlayerIntelEmbed(type, current, risk)],
        components: playerIntelButtons(type, current.steam64, false)
    });

    return true;
}

async function sendPlayerIntelAlerts(client, current) {
    let sent = 0;
    const risk = calculateRisk(current);

    if (current.previous_bans > 0) {
        if (await sendPlayerIntelAlert(client, "previous_bans", current, risk)) sent++;
    }

    if (current.dayz_hours > 0 && current.dayz_hours < LOW_DAYZ_HOURS) {
        if (await sendPlayerIntelAlert(client, "low_hours", current, risk)) sent++;
    }

    if (risk.accountAgeDays !== null && risk.accountAgeDays >= 0 && risk.accountAgeDays < FRESH_STEAM_ACCOUNT_DAYS) {
        if (await sendPlayerIntelAlert(client, "fresh_account", current, risk)) sent++;
    }

    if (risk.score >= RISK_ALERT_SCORE) {
        if (await sendPlayerIntelAlert(client, "risk_analysis", current, risk)) sent++;
    }

    return sent;
}

async function handlePlayerIntelButton(interaction) {
    if (!interaction.isButton?.()) return false;
    if (!interaction.customId?.startsWith("playerintel_")) return false;

    const parts = interaction.customId.split("_");
    const action = parts[1];
    const steam64 = parts.pop();
    const type = parts.slice(2).join("_");
    const key = `${type}:${steam64}`;

    if (action === "deactivate") {
        mutedPlayerIntelAlerts.add(key);

        await interaction.update({
            components: playerIntelButtons(type, steam64, true)
        });
        return true;
    }

    if (action === "reactivate") {
        mutedPlayerIntelAlerts.delete(key);

        await interaction.update({
            components: playerIntelButtons(type, steam64, false)
        });
        return true;
    }

    return false;
}

function buildAltAlertEmbed(current, matched) {
    return new EmbedBuilder()
        .setTitle("🚨 GrevBot Alt Account Detection")
        .setColor(0xff0000)
        .setDescription("**Possible alt account detected**\nShared IP found between two accounts.")
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
                name: "🕵️ Matched Account",
                value:
                    `🎮 **Name:** ${playerLink(matched.last_name, matched.cftools_id)}\n` +
                    `🆔 **CFTools:** ${idLink(matched.cftools_id, matched.cftools_id)}\n` +
                    `🔗 **Steam64:** ${idLink(matched.steam64, matched.cftools_id)}\n` +
                    `🌐 **IP:** \`${matched.ip_masked || current.ip_masked}\`\n` +
                    `🏢 **Provider:** ${matched.provider || current.provider || "Unknown"}\n` +
                    `📍 **Country:** ${matched.country_name || matched.country_code || current.country_name || "Unknown"}`,
                inline: true
            },
            {
                name: "📊 Match Details",
                value:
                    `⚠️ **Type:** Shared IP\n` +
                    `🔥 **Confidence:** HIGH\n` +
                    `📅 **First Seen:** ${formatDate(matched.first_seen)}\n` +
                    `📈 **Times Seen:** ${matched.seen_count || 1}`,
                inline: false
            }
        )
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

async function sendAltAlert(client, current, matched) {
    const channelId = process.env.ALT_ALERT_CHANNEL_ID || "1508534144286589132";

    let channel;
    try {
        channel = await client.channels.fetch(channelId);
    } catch (err) {
        console.error("Alt alert channel fetch failed:", err);
        return;
    }

    if (!channel) return;

    const embed = buildAltAlertEmbed(current, matched);
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
        steam_created: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        dayz_hours: 12,
        previous_bans: 1,
        ip_masked: "37.166.xxx.xxx",
        ip_subnet: "37.166.44.xxx",
        provider: "Free Mobile SAS",
        country_name: "France"
    };

    const matched = {
        last_name: "SneakyAlt",
        cftools_id: "6489fd3e8eabcc78746ab111",
        steam64: "76561198000000099",
        ip_masked: "37.166.xxx.xxx",
        ip_subnet: "37.166.44.xxx",
        provider: "Free Mobile SAS",
        country_name: "France",
        first_seen: "2026-05-25",
        seen_count: 14,
        last_ban_seen: new Date()
    };

    recentBansBySteam64.set(matched.steam64, {
        timestamp: Date.now(),
        reason: "Cheater - BE ban",
        name: "SneakyAlt"
    });

    await channel.send({ embeds: [buildAltAlertEmbed(current, matched)] });
    await channel.send({ embeds: [buildSubnetBanEvasionEmbed(current, matched)] });
    await sendPlayerIntelAlerts(client, current);
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
    let playerIntelAlerts = 0;
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
            steam_created: extractSteamCreated(p) || await getSteamAccountCreated(steam64),
            dayz_hours: extractDayZHours(p),
            previous_bans: extractPreviousBans(p),
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

        playerIntelAlerts += await sendPlayerIntelAlerts(client, current);

        for (const matched of previousMatches) {
            const exists = await altCaseExists(currentPlayerId, matched.player_id, "Shared IP");
            if (exists) continue;

            await createAltCase(currentPlayerId, matched.player_id, "Shared IP", 90);
            await sendAltAlert(client, current, matched);
            alerts++;
        }

        for (const matched of subnetMatches) {
            const exists = await altCaseExists(currentPlayerId, matched.player_id, "Subnet ban evasion pattern");
            if (exists) continue;

            await createAltCase(currentPlayerId, matched.player_id, "Subnet ban evasion pattern", 70);
            await sendSubnetBanEvasionAlert(client, current, matched);
            subnetAlerts++;
        }
    }

    return { found, saved, alerts, subnetAlerts, playerIntelAlerts, skipped };
}

module.exports = {
    syncAndDetect,
    getCFToolsGSMList,
    sendTestAltAlert,
    manualAltCheck,
    markPlayerBannedByCFToolsId,
    markPlayerBannedBySteam64,
    checkBanlistsForCftoolsId,
    handleBanWebhookMessage,
    handlePlayerIntelButton
};
