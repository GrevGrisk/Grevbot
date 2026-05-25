const crypto = require("crypto");
const axios = require("axios");
const { EmbedBuilder } = require("discord.js");
const pool = require("./db");

const CF_BASE = "https://data.cftools.cloud";

function maskIP(ip) {
    if (!ip) return "Unknown";
    const parts = ip.split(".");
    if (parts.length !== 4) return "Hidden";
    return `${parts[0]}.${parts[1]}.xxx.xxx`;
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

async function getOrCreatePlayer(player) {
    const steam64 = player.steam64;
    const cftoolsId = player.cftools_id || null;
    const beguid = player.beguid || null;
    const name = player.player_name || null;

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
                last_name = $3
            WHERE id = $4
        `, [cftoolsId, beguid, name, existing.rows[0].id]);

        return existing.rows[0].id;
    }

    const created = await pool.query(`
        INSERT INTO alt_players
        (steam64, cftools_id, beguid, last_name, created_at)
        VALUES ($1, $2, $3, $4, CURRENT_DATE)
        RETURNING id
    `, [steam64, cftoolsId, beguid, name]);

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
                country_name = $4
            WHERE id = $5
        `, [
            data.ip_masked,
            data.provider,
            data.country_code,
            data.country_name,
            existing.rows[0].id
        ]);
    } else {
        await pool.query(`
            INSERT INTO alt_ip_links
            (player_id, ip_hash, server_id, first_seen, last_seen, seen_count, ip_masked, provider, country_code, country_name)
            VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE, 1, $4, $5, $6, $7)
        `, [
            playerId,
            ipHash,
            process.env.CFTOOLS_SERVER_API_ID,
            data.ip_masked,
            data.provider,
            data.country_code,
            data.country_name
        ]);
    }
}

async function altCaseExists(currentPlayerId, matchedPlayerId) {
    const result = await pool.query(`
        SELECT id FROM alt_cases
        WHERE (
            player_id = $1 AND matched_player_id = $2
        ) OR (
            player_id = $2 AND matched_player_id = $1
        )
        LIMIT 1
    `, [currentPlayerId, matchedPlayerId]);

    return result.rows.length > 0;
}

async function createAltCase(currentPlayerId, matchedPlayerId) {
    await pool.query(`
        INSERT INTO alt_cases
        (player_id, matched_player_id, score, reason, created_at)
        VALUES ($1, $2, $3, $4, CURRENT_DATE)
    `, [
        currentPlayerId,
        matchedPlayerId,
        90,
        "Shared IP"
    ]);
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

    const embed = new EmbedBuilder()
        .setTitle("GrevBot alt account detection")
        .setColor(0xff0000)
        .setDescription("🚨 **Possible alt account detected !** 🚨")
        .addFields(
            {
                name: "👤 Current Player",
                value:
                    `**Name:** ${playerLink(current.player_name, current.cftools_id)}\n` +
                    `**CFTools ID:** ${idLink(current.cftools_id, current.cftools_id)}\n` +
                    `**Steam 64 ID:** ${idLink(current.steam64, current.cftools_id)}\n` +
                    `**IP address matched:** ${current.ip_masked}\n` +
                    `**Provider:** ${current.provider || "Unknown"}\n` +
                    `**Country of origin:** ${current.country_name || current.country_code || "Unknown"}`,
                inline: false
            },
            {
                name: "🧾 Matched previous account",
                value:
                    `**Name:** ${playerLink(matched.last_name, matched.cftools_id)}\n` +
                    `**CFTools ID:** ${idLink(matched.cftools_id, matched.cftools_id)}\n` +
                    `**Steam 64 ID:** ${idLink(matched.steam64, matched.cftools_id)}\n` +
                    `**IP address matched:** ${matched.ip_masked || current.ip_masked}\n` +
                    `**Provider:** ${matched.provider || current.provider || "Unknown"}\n` +
                    `**Country of origin:** ${matched.country_name || matched.country_code || current.country_name || "Unknown"}`,
                inline: false
            },
            {
                name: "🔎 Match Details",
                value:
                    `**Match Type:** Shared IP\n` +
                    `**Confidence:** HIGH\n` +
                    `**First Seen:** ${matched.first_seen ? new Date(matched.first_seen).toISOString().split("T")[0] : "Unknown"}\n` +
                    `**Times Seen:** ${matched.seen_count || 1}`,
                inline: false
            }
        )
        .setFooter({ text: "GrevBot • Alt account detection" })
        .setTimestamp();

    await channel.send({ embeds: [embed] });
}

async function syncAndDetect(client) {
    const list = await getCFToolsGSMList();
    const players = normalizePlayers(list);

    let found = 0;
    let saved = 0;
    let alerts = 0;
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
            ip,
            ip_masked: maskIP(ip),
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
        const currentPlayerId = await getOrCreatePlayer(current);

        await saveIpLink(currentPlayerId, ipHash, current);
        saved++;

        for (const matched of previousMatches) {
            const exists = await altCaseExists(currentPlayerId, matched.player_id);
            if (exists) continue;

            await createAltCase(currentPlayerId, matched.player_id);
            await sendAltAlert(client, current, matched);
            alerts++;
        }
    }

    return { found, saved, alerts, skipped };
}

module.exports = {
    syncAndDetect,
    getCFToolsGSMList
};
