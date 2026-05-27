const { EmbedBuilder } = require("discord.js");
const axios = require("axios");
const pool = require("./db");
const statsAlert = require("./statsAlertModule");

const CF_BASE = "https://data.cftools.cloud";

let cachedToken = null;
let cachedTokenExpires = 0;

// ===== HELPERS =====

function extractCFID(link) {
    if (!link) return null;

    const match = link.match(/\((https?:\/\/[^\)]+)\)/);
    if (match) {
        link = match[1];
    }

    const parts = link.split("/");
    return parts[parts.length - 1];
}

function buildProfileLink(cfid) {
    return `https://app.cftools.cloud/profile/${cfid}`;
}

function formatDate(value) {
    if (!value) return "Unknown";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";

    return date.toISOString().split("T")[0];
}

function getNestedValue(obj, paths) {
    for (const path of paths) {
        const value = path.split(".").reduce((acc, key) => {
            if (acc && Object.prototype.hasOwnProperty.call(acc, key)) {
                return acc[key];
            }
            return undefined;
        }, obj);

        if (value !== undefined && value !== null && value !== "") {
            return value;
        }
    }

    return null;
}

async function getCFToken() {
    if (cachedToken && Date.now() < cachedTokenExpires) {
        return cachedToken;
    }

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

    cachedToken = response.data.token;
    cachedTokenExpires = Date.now() + (23 * 60 * 60 * 1000);

    return cachedToken;
}

async function getCFServerPlayer(cfid) {
    try {
        const token = await getCFToken();

        const response = await axios.get(
            `${CF_BASE}/v2/server/${process.env.CFTOOLS_SERVER_API_ID}/player`,
            {
                headers: {
                    "User-Agent": process.env.CFTOOLS_APP_ID,
                    "Authorization": `Bearer ${token}`
                },
                params: {
                    cftools_id: cfid
                }
            }
        );

        return response.data;
    } catch (err) {
        console.error("CF server player fetch error:", err.response?.data || err.message || err);
        return null;
    }
}

async function getCFUserLookup(identifier) {
    if (!identifier) return null;

    try {
        const token = await getCFToken();

        const response = await axios.get(
            `${CF_BASE}/v1/users/lookup`,
            {
                headers: {
                    "User-Agent": process.env.CFTOOLS_APP_ID,
                    "Authorization": `Bearer ${token}`
                },
                params: {
                    identifier
                }
            }
        );

        return response.data;
    } catch (err) {
        console.error("CF user lookup error:", err.response?.data || err.message || err);
        return null;
    }
}

async function getAltPlayerByCfid(cfid) {
    try {
        const result = await pool.query(`
            SELECT
                steam64,
                cftools_id,
                last_name,
                steam_created,
                dayz_hours,
                previous_bans
            FROM alt_players
            WHERE cftools_id = $1
            LIMIT 1
        `, [cfid]);

        return result.rows[0] || null;
    } catch (err) {
        console.error("Alt player lookup error:", err);
        return null;
    }
}

function extractSteamCreated(serverPlayer, userLookup) {
    return getNestedValue(serverPlayer, [
        "persona.profile.created_at",
        "persona.profile.timecreated",
        "persona.created_at",
        "profile.created_at",
        "profile.timecreated",
        "steam.created_at",
        "steam.timecreated",
        "created_at"
    ]) || getNestedValue(userLookup, [
        "persona.profile.created_at",
        "persona.profile.timecreated",
        "persona.created_at",
        "profile.created_at",
        "profile.timecreated",
        "steam.created_at",
        "steam.timecreated",
        "created_at"
    ]);
}

function extractDayZHours(serverPlayer) {
    const seconds = getNestedValue(serverPlayer, [
        "info.radar.indicators.playtime_total",
        "radar.indicators.playtime_total",
        "stats.playtime",
        "playtime",
        "data.playtime",
        "player.playtime"
    ]);

    if (!seconds || Number.isNaN(Number(seconds))) return 0;

    return Math.round((Number(seconds) / 3600) * 10) / 10;
}

function extractPreviousServerBans(serverPlayer) {
    const bans = getNestedValue(serverPlayer, [
        "info.ban_count",
        "ban_count",
        "data.info.ban_count",
        "player.info.ban_count"
    ]);

    if (!bans || Number.isNaN(Number(bans))) return 0;

    return Number(bans);
}

async function getKDStats(cfid) {
    try {
        const killsResult = await pool.query(`
            SELECT COUNT(*)::int AS count
            FROM player_deaths
            WHERE killer = $1
        `, [cfid]);

        const deathsResult = await pool.query(`
            SELECT COUNT(*)::int AS count
            FROM player_deaths
            WHERE victim = $1
        `, [cfid]);

        const kills = killsResult.rows[0]?.count || 0;
        const deaths = deathsResult.rows[0]?.count || 0;

        const kd = deaths > 0
            ? (kills / deaths).toFixed(2)
            : kills.toFixed(2);

        return {
            kills,
            deaths,
            kd
        };
    } catch (err) {
        console.error("KD stats error:", err);
        return {
            kills: 0,
            deaths: 0,
            kd: "0.00"
        };
    }
}

// 🔥 LOS MAP LINK
function buildMapLink(death) {
    if (!death) return null;

    const killerX = death.killer_x ?? death.killerX ?? death.kx;
    const killerY = death.killer_y ?? death.killerY ?? death.ky;
    const victimX = death.x ?? death.victim_x ?? death.victimX ?? death.vx;
    const victimY = death.y ?? death.victim_y ?? death.victimY ?? death.vy;

    if (!killerX || !killerY || !victimX || !victimY) return null;

    const weapon = death.weapon || "-";
    const distance = death.distance || "-";
    const damage = death.damage ?? "-";
    const hitzone = death.hitzone ?? death.zone ?? "-";

    return `https://grevgrisk.github.io/dayzmap?killer=${killerX},${killerY}&victim=${victimX},${victimY}&weapon=${encodeURIComponent(weapon)}&dist=${distance}&dmg=${damage}&hit=${encodeURIComponent(hitzone)}`;
}

// ===== HANDLE STATS =====

async function handleStats(client, hit) {
    try {
        const killerId = extractCFID(hit.killerLink);
        if (!killerId) return;

        const zone = String(hit.zone || "")
            .toLowerCase()
            .replace(/[\s_-]/g, "");

        const columnMap = {
            brain: "brain",
            head: "head",
            torso: "torso",
            leftarm: "left_arm",
            rightarm: "right_arm",
            leftleg: "left_leg",
            rightleg: "right_leg"
        };

        const column = columnMap[zone] || "torso";

        await pool.query(`
            INSERT INTO player_stats (player, name, ${column}, total)
            VALUES ($1, $2, 1, 1)
            ON CONFLICT (player)
            DO UPDATE SET
                name = EXCLUDED.name,
                ${column} = player_stats.${column} + 1,
                total = player_stats.total + 1
        `, [
            killerId,
            hit.killerName || killerId
        ]);

        const updatedStats = await getStatsById(killerId);
        await statsAlert.checkPlayer(client, hit, updatedStats);

    } catch (err) {
        console.error("Stats DB error:", err);
    }
}

// ===== FETCH =====

async function getStatsById(cfid) {
    const res = await pool.query(
        "SELECT * FROM player_stats WHERE player = $1",
        [cfid]
    );
    return res.rows[0];
}

async function getLastDeaths(cfid) {
    try {
        const res = await pool.query(`
            SELECT * FROM player_deaths
            WHERE victim = $1
            ORDER BY created_at DESC
            LIMIT 5
        `, [cfid]);

        return res.rows;
    } catch (err) {
        console.error("Death fetch error:", err);
        return [];
    }
}

async function getLastKills(cfid) {
    try {
        const res = await pool.query(`
            SELECT * FROM player_deaths
            WHERE killer = $1
            ORDER BY created_at DESC
            LIMIT 5
        `, [cfid]);

        return res.rows;
    } catch (err) {
        console.error("Kills fetch error:", err);
        return [];
    }
}

// ===== CHART =====

function buildChart(stats) {
    const raw = [
        { label: "Brain", value: stats.brain || 0, color: "#4FC3F7" },
        { label: "Head", value: stats.head || 0, color: "#9575CD" },
        { label: "Torso", value: stats.torso || 0, color: "#F06292" },
        { label: "Arms", value: (stats.left_arm || 0) + (stats.right_arm || 0), color: "#FFB74D" },
        { label: "Legs", value: (stats.left_leg || 0) + (stats.right_leg || 0), color: "#4DB6AC" }
    ];

    const total = raw.reduce((sum, e) => sum + e.value, 0);

    const pct = (v) =>
        total > 0 ? parseFloat(((v / total) * 100).toFixed(1)) : 0;

    const chartConfig = {
        type: "pie",
        data: {
            labels: raw.map(e => e.label),
            datasets: [{
                data: raw.map(e => pct(e.value)),
                backgroundColor: raw.map(e => e.color),
                borderColor: "#ffffff",
                borderWidth: 2
            }]
        },
        options: {
            legend: {
                labels: {
                    fontColor: "#ffffff",
                    fontSize: 20,
                    fontStyle: "bold"
                }
            },
            plugins: {
                datalabels: {
                    color: "#000000",
                    backgroundColor: "#ffffff",
                    borderRadius: 4,
                    padding: 4,
                    font: {
                        size: 20,
                        weight: "bold"
                    },
                    formatter: function(value) {
                        return value;
                    }
                }
            }
        }
    };

    return `https://quickchart.io/chart?devicePixelRatio=3&width=800&height=600&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
}

function buildLastDeathsText(deaths) {
    if (!Array.isArray(deaths) || deaths.length === 0) {
        return "-";
    }

    const lines = deaths.map(d => {
        const killerText = d.killer
            ? `[${d.killer_name || "Unknown"}](${buildProfileLink(d.killer)})`
            : `${d.killer_name || "Unknown"}`;

        const weapon = d.weapon || "-";
        const distance = d.distance ? `${d.distance}m` : "-";

        const mapLink = buildMapLink(d);
        const mapText = mapLink ? ` | [View](${mapLink})` : "";

        return `💀 ${killerText} | ${weapon} | ${distance}${mapText}`;
    });

    let buffer = "";

    for (const line of lines) {
        if ((buffer + line + "\n").length > 1024) break;
        buffer += line + "\n";
    }

    return buffer.trim() || "-";
}

function buildLastKillsText(kills) {
    if (!Array.isArray(kills) || kills.length === 0) {
        return "-";
    }

    const lines = kills.map(k => {
        const victimText = k.victim
            ? `[${k.victim_name || "Unknown"}](${buildProfileLink(k.victim)})`
            : `${k.victim_name || "Unknown"}`;

        const weapon = k.weapon || "-";
        const distance = k.distance ? `${k.distance}m` : "-";

        const mapLink = buildMapLink(k);
        const mapText = mapLink ? ` | [View](${mapLink})` : "";

        return `☠️ ${victimText} | ${weapon} | ${distance}${mapText}`;
    });

    let buffer = "";

    for (const line of lines) {
        if ((buffer + line + "\n").length > 1024) break;
        buffer += line + "\n";
    }

    return buffer.trim() || "-";
}

// ===== PROFILE =====

async function handleProfile(interaction) {
    const cfid = interaction.options.getString("cfid");

    try {
        let stats = await getStatsById(cfid);

        if (!stats) {
            stats = {
                player: cfid,
                name: cfid,
                brain: 0,
                head: 0,
                torso: 0,
                left_arm: 0,
                right_arm: 0,
                left_leg: 0,
                right_leg: 0,
                total: 0
            };
        }

        const altPlayer = await getAltPlayerByCfid(cfid);
        const kdStats = await getKDStats(cfid);

        const steamCreated = altPlayer?.steam_created || null;
        const dayzHours = altPlayer?.dayz_hours ?? 0;
        const previousBans = altPlayer?.previous_bans ?? 0;

        const brain = stats.brain || 0;
        const head = stats.head || 0;
        const torso = stats.torso || 0;
        const arms = (stats.left_arm || 0) + (stats.right_arm || 0);
        const legs = (stats.left_leg || 0) + (stats.right_leg || 0);

        const totalShots = brain + head + torso + arms + legs;

        const calc = (v) =>
            totalShots > 0 ? ((v / totalShots) * 100).toFixed(1) : "0.0";

        const deaths = await getLastDeaths(cfid);
        const kills = await getLastKills(cfid);

        const deathsText = buildLastDeathsText(deaths);
        const killsText = buildLastKillsText(kills);

        const embed = new EmbedBuilder()
            .setColor("#00c853")
            .setTitle("GrevBot Player Profile Analysis")
            .setDescription(
                `👤 **${stats.name || altPlayer?.last_name || cfid}**\n` +
                `[Open Profile](${buildProfileLink(cfid)})\n\n` +
                `🆔 \`${cfid}\``
            )
            .addFields(
                {
                    name: "🧠 Player Intel",
                    value:
                        `📅 **Steam account created:** ${formatDate(steamCreated)}\n` +
                        `⏱️ **DayZ hours:** ${dayzHours}\n` +
                        `🚫 **Previous bans:** ${previousBans}\n` +
                        `⚔️ **Kills:** ${kdStats.kills}\n` +
                        `💀 **Deaths:** ${kdStats.deaths}\n` +
                        `📈 **K/D:** ${kdStats.kd}`
                },
                {
                    name: "📊 Total Shots Hit",
                    value: `**${totalShots}**\n`
                },
                {
                    name: "📈 Hit Distribution (Count / %)",
                    value:
                        `🔵 Brain: ${brain} (${calc(brain)}%)\n` +
                        `🟣 Head: ${head} (${calc(head)}%)\n` +
                        `🔴 Torso: ${torso} (${calc(torso)}%)\n` +
                        `🟠 Arms: ${arms} (${calc(arms)}%)\n` +
                        `🟢 Legs: ${legs} (${calc(legs)}%)\n`
                },
                {
                    name: "☠️ Last Kills",
                    value: killsText
                },
                {
                    name: "☠️ Last Deaths",
                    value: deathsText
                }
            )
            .setImage(buildChart(stats))
            .setFooter({
                text: "Grevbot Player-analysis- 2026"
            });

        await interaction.reply({ embeds: [embed] });

    } catch (err) {
        console.error("Profile error:", err);

        await interaction.reply({
            content: "Feil ved henting av stats.",
            ephemeral: true
        });
    }
}

module.exports = {
    handleStats,
    getStatsById,
    handleProfile
};
