const { EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function extractCFID(link) {
    if (!link) return null;
    return link.split("/").pop();
}

function buildProfileLink(cfid) {
    return `https://app.cftools.cloud/profile/${cfid}`;
}

// ===== HANDLE STATS =====
async function handleStats(hit) {
    try {
        const killerId = extractCFID(hit.killerLink);
        if (!killerId) return;

        const zone = String(hit.zone || "").toLowerCase().replace(/[\s_-]/g, "");

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
        `, [killerId, hit.killerName]);

    } catch (err) {
        console.error("Stats DB error:", err);
    }
}

// ===== GET PROFILE =====
async function getStatsById(cfid) {
    const res = await pool.query(
        "SELECT * FROM player_stats WHERE player = $1",
        [cfid]
    );
    return res.rows[0];
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

// ===== HANDLE PROFILE =====
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

        const embed = new EmbedBuilder()
            .setColor("#00c853") // 🔥 grønn kant
            .setTitle("GrevBot Player Profile Analysis")
            .setDescription(
                `👤 **${stats.name || cfid}**\n` +
                `[Open Profile](${buildProfileLink(cfid)})\n\n` + // spacing
                `🆔 \`${cfid}\``
            )
            .addFields(
                {
                    name: "📊 Total Shots Hit",
                    value: `**${totalShots}**\n`, // spacing
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
        console.error(err);
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
