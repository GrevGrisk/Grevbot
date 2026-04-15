const { EmbedBuilder } = require("discord.js");
const pool = require("./db");
const statsAlert = require("./statsAlertModule");

// ===== HELPERS =====

function extractCFID(link) {
    if (!link) return null;
    return link.split("/").pop();
}

function buildProfileLink(cfid) {
    return `https://app.cftools.cloud/profile/${cfid}`;
}

function buildMapLink(x, y) {
    if (!x || !y) return null;
    return `https://dayz.ginfo.gg/#location=${x};${y}`;
}

// ===== HANDLE STATS (LIVE UPDATES) =====

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
            INSERT INTO player_stats (player, name, ${column})
            VALUES ($1, $2, 1)
            ON CONFLICT (player)
            DO UPDATE SET
                name = EXCLUDED.name,
                ${column} = player_stats.${column} + 1
        `, [
            killerId,
            hit.killerName
        ]);

        const updatedStats = await getStatsById(killerId);

        // 🔥 ALERT CHECK
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

    const filtered = raw.filter(e => e.value > 0);
    const total = filtered.reduce((sum, e) => sum + e.value, 0);

    const pct = (v) =>
        total > 0 ? parseFloat(((v / total) * 100).toFixed(1)) : 0;

    const chartConfig = {
        type: "pie",
        data: {
            labels: filtered.map(e => e.label),
            datasets: [{
                data: filtered.map(e => pct(e.value)),
                backgroundColor: filtered.map(e => e.color),
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

// ===== PROFILE COMMAND =====

async function handleProfile(interaction) {
    const cfid = interaction.options.getString("cfid");

    try {
        const stats = await getStatsById(cfid);

        if (!stats) {
            return interaction.reply({
                content: "Ingen data funnet.",
                ephemeral: true
            });
        }

        const brain = stats.brain || 0;
        const head = stats.head || 0;
        const torso = stats.torso || 0;
        const arms = (stats.left_arm || 0) + (stats.right_arm || 0);
        const legs = (stats.left_leg || 0) + (stats.right_leg || 0);

        const totalShots = brain + head + torso + arms + legs;

        const calc = (v) =>
            totalShots > 0 ? ((v / totalShots) * 100).toFixed(1) : "0.0";

        const deaths = await getLastDeaths(cfid);

        let deathsText = "No recent deaths";

        if (deaths.length > 0) {
            deathsText = deaths.map(d => {
                const killerLink = d.killer
                    ? `[${d.killer_name || "Unknown"}](https://app.cftools.cloud/profile/${d.killer})`
                    : `${d.killer_name || "Unknown"}`;

                const mapLink = buildMapLink(d.x, d.y);
                const mapText = mapLink ? ` | [Map](${mapLink})` : "";

                return `💀 ${killerLink} | ${d.weapon || "-"} | ${d.distance || "-"}m${mapText}`;
            }).join("\n");
        }

        const embed = new EmbedBuilder()
            .setColor("#00c853")
            .setTitle("GrevBot Player Profile Analysis")
            .setDescription(
                `👤 **${stats.name || cfid}**\n` +
                `[Open Profile](${buildProfileLink(cfid)})\n\n` +
                `🆔 \`${cfid}\`\n\n` +
                `☠️ **Last Deaths**\n${deathsText}`
            )
            .addFields(
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
 
