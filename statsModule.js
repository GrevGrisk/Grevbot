const { EmbedBuilder } = require("discord.js");
const axios = require("axios");
const pool = require("./db");
const statsAlert = require("./statsAlertModule");

const CF_BASE = "https://data.cftools.cloud";

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

async function getCFToken() {
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

async function getCFProfile(cfid) {
    try {
        const token = await getCFToken();

        const response = await axios.get(
            `${CF_BASE}/v1/player`,
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
        console.error("CF profile fetch error:", err.response?.data || err.message || err);
        return null;
    }
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

        const profile = await getCFProfile(cfid);
        const kdStats = await getKDStats(cfid);

        const steamCreated =
            profile?.persona?.profile?.created_at ||
            profile?.persona?.profile?.timecreated ||
            profile?.persona?.created_at ||
            profile?.profile?.created_at ||
            null;

        const dayzSeconds =
            profile?.info?.radar?.indicators?.playtime_total ||
            profile?.stats?.playtime ||
            profile?.playtime ||
            0;

        const dayzHours = Math.round((dayzSeconds / 3600) * 10) / 10;

        const previousBans =
            profile?.info?.ban_count ||
            0;

        const brain = stats.brain || 0;
        const head = stats.head || 0;
        const torso = stats.torso || 0;
        const arms = (stats.left_arm || 0) + (stats.right_arm || 0);
        const legs = (stats.left_leg || 0) + (stats.right_leg || 0);

        const totalShots = brain + head + torso + arms + legs;

        const calc = (v) =>
            totalShots > 0 ? ((v / totalShots) * 100).toFixed(1) : "0.0";

        const deaths = await getLastDeaths(cfid);

        let deathsText = "-";

        if (Array.isArray(deaths) && deaths.length > 0) {
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

            deathsText = buffer.trim() || "-";
        }

        const embed = new EmbedBuilder()
            .setColor("#00c853")
            .setTitle("GrevBot Player Profile Analysis")
            .setDescription(
                `👤 **${stats.name || cfid}**\n` +
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
                }
            )
            .setImage(buildChart(stats))
            .addFields({
                name: "☠️ Last Deaths",
                value: deathsText
            })
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
