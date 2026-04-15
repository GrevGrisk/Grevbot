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
            INSERT INTO player_stats (player, name, ${column}, total)
            VALUES ($1, $2, 1, 1)
            ON CONFLICT (player)
            DO UPDATE SET
                name = EXCLUDED.name,
                ${column} = player_stats.${column} + 1,
                total = player_stats.total + 1
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

// ===== CHART (MATCHES YOUR FRIEND) =====
function buildChart(stats) {
    const brain = stats.brain || 0;
    const head = stats.head || 0;
    const torso = stats.torso || 0;
    const arms = (stats.left_arm || 0) + (stats.right_arm || 0);
    const legs = (stats.left_leg || 0) + (stats.right_leg || 0);

    const total = brain + head + torso + arms + legs;

    const pct = (v) =>
        total > 0 ? parseFloat(((v / total) * 100).toFixed(1)) : 0;

    const chartConfig = {
        type: "pie",
        data: {
            labels: ["Brain", "Head", "Torso", "Arms", "Legs"],
            datasets: [{
                data: [
                    pct(brain),
                    pct(head),
                    pct(torso),
                    pct(arms),
                    pct(legs)
                ],
                backgroundColor: [
                    "#4FC3F7",
                    "#9575CD",
                    "#F06292",
                    "#FFB74D",
                    "#4DB6AC"
                ],
                borderColor: "white",
                borderWidth: 2
            }]
        },
        options: {
            legend: { // 🔥 v2 syntax
                labels: {
                    fontColor: "white",
                    fontSize: 14
                }
            },
            plugins: {
                datalabels: {
                    color: "black",
                    font: {
                        size: 24,
                        weight: "bold"
                    },
                    formatter: function(value) {
                        return value > 0 ? value + "%" : "";
                    }
                }
            }
        }
    };

    return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
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

        const total = brain + head + torso + arms + legs;

        const calc = (v) =>
            total > 0 ? ((v / total) * 100).toFixed(1) : "0.0";

        const embed = new EmbedBuilder()
            .setColor("#2b2d31")
            .setTitle("GrevBot Player Profile Analysis")
            .setDescription(
                `👤 **[${stats.name || cfid}](${buildProfileLink(cfid)})**\n` +
                `🆔 \`${cfid}\``
            )
            .addFields(
                {
                    name: "📊 Total Shots Hit",
                    value: `**${stats.total || 0}**`
                },
                {
                    name: "📈 Hit Distribution (Count / %)",
                    value:
                        `🔵 Brain: ${brain} (${calc(brain)}%)\n` +
                        `🟣 Head: ${head} (${calc(head)}%)\n` +
                        `🔴 Torso: ${torso} (${calc(torso)}%)\n` +
                        `🟠 Arms: ${arms} (${calc(arms)}%)\n` +
                        `🟢 Legs: ${legs} (${calc(legs)}%)`
                }
            )
            .setImage(buildChart(stats))
            .setFooter({ text: "Grevbot Player-analysis- 2026" });

        await interaction.reply({ embeds: [embed] });

    } catch (err) {
        console.error(err);
    }
}

module.exports = {
    handleStats,
    getStatsById,
    handleProfile
};
