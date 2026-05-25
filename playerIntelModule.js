const axios = require("axios");
const { EmbedBuilder } = require("discord.js");

const CF_BASE = "https://data.cftools.cloud";
const PLAYER_INTEL_CHANNEL_ID = "1508549810482057216";

const sentAlerts = new Set();

function cfProfileUrl(cftoolsId) {
    return cftoolsId ? `https://app.cftools.cloud/profile/${cftoolsId}` : null;
}

function linkText(text, cftoolsId) {
    const safe = text || "Unknown";
    const url = cfProfileUrl(cftoolsId);
    return url ? `[${safe}](${url})` : safe;
}

function formatDate(value) {
    if (!value) return "Unknown";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";

    return date.toISOString().split("T")[0];
}

function getSteamCreationDate(player) {
    return (
        player?.persona?.profile?.created_at ||
        player?.persona?.profile?.timecreated ||
        player?.persona?.created_at ||
        player?.profile?.created_at ||
        null
    );
}

function getDayZHours(player) {
    const seconds =
        player?.info?.radar?.indicators?.playtime_total ||
        player?.stats?.playtime ||
        player?.playtime ||
        0;

    return Math.round((seconds / 3600) * 10) / 10;
}

function getServerBanCount(player) {
    return player?.info?.ban_count || 0;
}

function getKills(player) {
    return (
        player?.stats?.kills ||
        player?.info?.radar?.indicators?.kills ||
        0
    );
}

function getDeaths(player) {
    return (
        player?.stats?.deaths ||
        player?.info?.radar?.indicators?.deaths ||
        0
    );
}

function getShotsFired(player) {
    return (
        player?.stats?.fired ||
        player?.info?.radar?.indicators?.fired ||
        0
    );
}

function getHits(player) {
    return (
        player?.stats?.hit_players ||
        player?.stats?.hits ||
        player?.info?.radar?.indicators?.hits ||
        0
    );
}

function getLongestKill(player) {
    return (
        player?.stats?.longest_kill ||
        player?.info?.radar?.indicators?.longest_kill ||
        player?.info?.radar?.indicators?.lsd ||
        0
    );
}

function getPlayerData(player) {
    const kills = getKills(player);
    const deaths = getDeaths(player);
    const fired = getShotsFired(player);
    const hits = getHits(player);
    const dayzHours = getDayZHours(player);
    const longestKill = getLongestKill(player);

    const kd = deaths > 0 ? kills / deaths : kills;
    const accuracy = fired > 0 ? (hits / fired) * 100 : 0;
    const killsPerHour = dayzHours > 0 ? kills / dayzHours : 0;

    return {
        name: player?.gamedata?.player_name || player?.persona?.profile?.name || "Unknown",
        cftoolsId: player?.cftools_id || null,
        steam64: player?.gamedata?.steam64 || "Unknown",
        steamCreated: getSteamCreationDate(player),
        dayzHours,
        serverBanCount: getServerBanCount(player),
        kills,
        deaths,
        fired,
        hits,
        kd: Math.round(kd * 100) / 100,
        accuracy: Math.round(accuracy * 10) / 10,
        killsPerHour: Math.round(killsPerHour * 10) / 10,
        longestKill: Math.round(longestKill * 10) / 10
    };
}

async function getToken() {
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

async function getGSMList() {
    const token = await getToken();

    const response = await axios.get(
        `${CF_BASE}/v1/server/${process.env.CFTOOLS_SERVER_API_ID}/GSM/list`,
        {
            headers: {
                "User-Agent": process.env.CFTOOLS_APP_ID,
                "Authorization": `Bearer ${token}`
            }
        }
    );

    return Array.isArray(response.data)
        ? response.data
        : (response.data.sessions || response.data.players || response.data.data || []);
}

function basePlayerField(data) {
    return (
        `🎮 **Name:** ${linkText(data.name, data.cftoolsId)}\n` +
        `🆔 **CFTools ID:** ${linkText(data.cftoolsId || "Unknown", data.cftoolsId)}\n` +
        `🔗 **Steam64 ID:** ${linkText(data.steam64, data.cftoolsId)}`
    );
}

function buildNewSteamEmbed(data) {
    return new EmbedBuilder()
        .setTitle("🟢 New Steam Account Alert")
        .setColor(0x00aa55)
        .setDescription("**A player with a brand new Steam account has logged onto the server.**")
        .addFields({
            name: "👤 Player",
            value:
                `${basePlayerField(data)}\n` +
                `📅 **Steam account creation date:** ${formatDate(data.steamCreated)}`,
            inline: false
        })
        .setFooter({ text: "GrevBot • Player intel" })
        .setTimestamp();
}

function buildLowHoursEmbed(data) {
    return new EmbedBuilder()
        .setTitle("🟠 Low DayZ Hours Alert")
        .setColor(0xff9900)
        .setDescription("**A player with less than 5 hours played on DayZ has logged onto the server.**")
        .addFields({
            name: "👤 Player",
            value:
                `${basePlayerField(data)}\n` +
                `⏱️ **Total amount of DayZ hours:** ${data.dayzHours}`,
            inline: false
        })
        .setFooter({ text: "GrevBot • Player intel" })
        .setTimestamp();
}

function buildPreviousBansEmbed(data) {
    return new EmbedBuilder()
        .setTitle("🔴 Previous Server Bans Alert")
        .setColor(0xff0000)
        .setDescription("**A player with previous server bans on his account has logged onto the server.**")
        .addFields({
            name: "👤 Player",
            value:
                `${basePlayerField(data)}\n` +
                `🚫 **Number of server bans:** ${data.serverBanCount}`,
            inline: false
        })
        .setFooter({ text: "GrevBot • Player intel" })
        .setTimestamp();
}

function calculateSuspicion(data) {
    let score = 0;
    const reasons = [];

    if (data.kills < 10) {
        return { trigger: false, score: 0, reasons: ["Not enough kills for evaluation"] };
    }

    if (data.dayzHours > 0 && data.dayzHours < 20) {
        score += 20;
        reasons.push(`Low playtime: ${data.dayzHours}h`);
    }

    if (data.kd >= 4 && data.kills >= 10) {
        score += 15;
        reasons.push(`High K/D: ${data.kd}`);
    }

    if (data.fired >= 200 && data.accuracy >= 55) {
        score += 20;
        reasons.push(`High accuracy: ${data.accuracy}% from ${data.fired} shots`);
    }

    if (data.killsPerHour >= 5 && data.kills >= 10) {
        score += 15;
        reasons.push(`High kills/hour: ${data.killsPerHour}`);
    }

    if (data.longestKill >= 600 && data.dayzHours > 0 && data.dayzHours < 20) {
        score += 15;
        reasons.push(`Long kill with low playtime: ${data.longestKill}m`);
    }

    if (data.serverBanCount > 0) {
        score += 25;
        reasons.push(`Previous server bans: ${data.serverBanCount}`);
    }

    return {
        trigger: score >= 50,
        score,
        reasons
    };
}

function buildSuspiciousStatsEmbed(data, suspicion) {
    return new EmbedBuilder()
        .setTitle("🟣 Suspicious Player Stats Alert")
        .setColor(0x8e44ad)
        .setDescription("**A player has suspicious K/D, accuracy, or combat stats compared to playtime.**")
        .addFields(
            {
                name: "👤 Player",
                value: basePlayerField(data),
                inline: false
            },
            {
                name: "📊 Combat Stats",
                value:
                    `☠️ **Kills:** ${data.kills}\n` +
                    `💀 **Deaths:** ${data.deaths}\n` +
                    `📈 **K/D:** ${data.kd}\n` +
                    `🔫 **Shots Fired:** ${data.fired}\n` +
                    `🎯 **Hits:** ${data.hits}\n` +
                    `🎯 **Accuracy:** ${data.accuracy}%\n` +
                    `⏱️ **DayZ Hours:** ${data.dayzHours}\n` +
                    `⚔️ **Kills/hour:** ${data.killsPerHour}\n` +
                    `📏 **Longest Kill:** ${data.longestKill}m`,
                inline: false
            },
            {
                name: "⚠️ Risk Score",
                value:
                    `**Score:** ${suspicion.score}/100\n` +
                    `**Reasons:**\n${suspicion.reasons.map(r => `• ${r}`).join("\n")}`,
                inline: false
            }
        )
        .setFooter({ text: "GrevBot • Suspicious stats detection" })
        .setTimestamp();
}

function isBrandNewSteamAccount(creationDate) {
    if (!creationDate) return false;

    const created = new Date(creationDate);
    if (Number.isNaN(created.getTime())) return false;

    const ageDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
    return ageDays <= 30;
}

async function sendEmbed(client, embed) {
    const channel = await client.channels.fetch(PLAYER_INTEL_CHANNEL_ID);
    await channel.send({ embeds: [embed] });
}

async function scanAndAlert(client) {
    const players = await getGSMList();

    let checked = 0;
    let alerts = 0;

    for (const player of players) {
        const data = getPlayerData(player);

        if (!data.steam64 || data.steam64 === "Unknown") continue;

        checked++;

        if (isBrandNewSteamAccount(data.steamCreated)) {
            const key = `newsteam:${data.steam64}`;
            if (!sentAlerts.has(key)) {
                sentAlerts.add(key);
                await sendEmbed(client, buildNewSteamEmbed(data));
                alerts++;
            }
        }

        if (data.dayzHours > 0 && data.dayzHours < 5) {
            const key = `lowhours:${data.steam64}`;
            if (!sentAlerts.has(key)) {
                sentAlerts.add(key);
                await sendEmbed(client, buildLowHoursEmbed(data));
                alerts++;
            }
        }

        if (data.serverBanCount > 0) {
            const key = `serverbans:${data.steam64}`;
            if (!sentAlerts.has(key)) {
                sentAlerts.add(key);
                await sendEmbed(client, buildPreviousBansEmbed(data));
                alerts++;
            }
        }

        const suspicion = calculateSuspicion(data);
        if (suspicion.trigger) {
            const key = `suspiciousstats:${data.steam64}`;
            if (!sentAlerts.has(key)) {
                sentAlerts.add(key);
                await sendEmbed(client, buildSuspiciousStatsEmbed(data, suspicion));
                alerts++;
            }
        }
    }

    return { checked, alerts };
}

async function sendTestIntelAlerts(client) {
    const testData = {
        name: "TestPlayer",
        cftoolsId: "6489fd3e8eabcc78746ab6fd",
        steam64: "76561198000000001",
        steamCreated: "2026-05-25",
        dayzHours: 2.3,
        serverBanCount: 3,
        kills: 27,
        deaths: 3,
        fired: 420,
        hits: 298,
        kd: 9,
        accuracy: 71,
        killsPerHour: 11.7,
        longestKill: 640
    };

    const suspicion = calculateSuspicion(testData);

    await sendEmbed(client, buildNewSteamEmbed(testData));
    await sendEmbed(client, buildLowHoursEmbed(testData));
    await sendEmbed(client, buildPreviousBansEmbed(testData));
    await sendEmbed(client, buildSuspiciousStatsEmbed(testData, suspicion));
}

module.exports = {
    scanAndAlert,
    sendTestIntelAlerts
};
