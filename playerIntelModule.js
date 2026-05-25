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

function getBanCount(player) {
    return (
        player?.info?.ban_count ||
        player?.info?.bans?.score ||
        player?.persona?.bans?.game ||
        player?.persona?.bans?.vac ||
        0
    );
}

function getPlayerData(player) {
    return {
        name: player?.gamedata?.player_name || player?.persona?.profile?.name || "Unknown",
        cftoolsId: player?.cftools_id || null,
        steam64: player?.gamedata?.steam64 || "Unknown",
        steamCreated: getSteamCreationDate(player),
        dayzHours: getDayZHours(player),
        banCount: getBanCount(player)
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
        .addFields(
            {
                name: "👤 Player",
                value:
                    `${basePlayerField(data)}\n` +
                    `📅 **Steam account creation date:** ${formatDate(data.steamCreated)}`,
                inline: false
            }
        )
        .setFooter({ text: "GrevBot • Player intel" })
        .setTimestamp();
}

function buildLowHoursEmbed(data) {
    return new EmbedBuilder()
        .setTitle("🟠 Low DayZ Hours Alert")
        .setColor(0xff9900)
        .setDescription("**A player with less than 5 hours played on DayZ has logged onto the server.**")
        .addFields(
            {
                name: "👤 Player",
                value:
                    `${basePlayerField(data)}\n` +
                    `⏱️ **Total amount of DayZ hours:** ${data.dayzHours}`,
                inline: false
            }
        )
        .setFooter({ text: "GrevBot • Player intel" })
        .setTimestamp();
}

function buildPreviousBansEmbed(data) {
    return new EmbedBuilder()
        .setTitle("🔴 Previous Bans Alert")
        .setColor(0xff0000)
        .setDescription("**A player with previous bans on his account has logged onto the server.**")
        .addFields(
            {
                name: "👤 Player",
                value:
                    `${basePlayerField(data)}\n` +
                    `🚫 **Number of bans:** ${data.banCount}`,
                inline: false
            }
        )
        .setFooter({ text: "GrevBot • Player intel" })
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

        if (data.banCount > 0) {
            const key = `bans:${data.steam64}`;
            if (!sentAlerts.has(key)) {
                sentAlerts.add(key);
                await sendEmbed(client, buildPreviousBansEmbed(data));
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
        banCount: 3
    };

    await sendEmbed(client, buildNewSteamEmbed(testData));
    await sendEmbed(client, buildLowHoursEmbed(testData));
    await sendEmbed(client, buildPreviousBansEmbed(testData));
}

module.exports = {
    scanAndAlert,
    sendTestIntelAlerts
};
