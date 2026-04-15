const { EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function extractCFID(link) {
    if (!link) return null;
    const parts = link.split("/");
    return parts[parts.length - 1];
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
        `, [
            killerId,
            hit.killerName
        ]);

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
    const brain = stats.brain || 0;
    const head = stats.head || 0;
    const torso = stats.torso || 0;
    const arms = (stats.left_arm || 0) + (stats.right_arm || 0);
    const legs = (stats.left_leg || 0) + (stats.right_leg || 0);

    const labels = ["Brain", "Head", "Torso", "Arms", "Legs"];
    const data = [brain, head, torso, arms, legs];

    const chartConfig = {
        type: "pie",
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: [
                    "#4FC3F7",
                    "#9575CD",
                    "#F06292",
                    "#FFB74D",
                    "#4DB6AC"
                ],
                borderColor: "#ffffff",
                borderWidth: 3
            }]
        },
        options: {
            layout: {
                padding: 30
            },
            plugins: {
                legend: {
                    position: "top",
                    labels: {
                        color: "#ffffff",
                        boxWidth: 30,
                        boxHeight: 15,
                        padding: 25,
                        font: {
                            size: 20,
                            weight: "bold"
                        }
                    }
                },
                datalabels: {
                    color: "#000000",
                    backgroundColor: "#ffffff",
                    borderRadius: 4,
                    padding: 6,
                    font: {
                        size: 18,
                        weight: "bold"
                    },
                    formatter: (value) => value > 0 ? value : ""
                }
            }
        }
    };

    return `https://quickchart.io/chart?width=900&height=650&devicePixelRatio=2&backgroundColor=transparent&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
}

// ===== HANDLE /PROFILE =====
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

        const totalShots = stats.total || 0;

        const brain = stats.brain || 0;
        const head = stats.head || 0;
        const torso = stats.torso || 0;
        const arms = (stats.left_arm || 0) + (stats.right_arm || 0);
        const legs = (stats.left_leg || 0) + (stats.right_leg || 0);

        const distributionTotal = brain + head + torso + arms + legs;

        const calc = (v) =>
            distributionTotal > 0 ? ((v / distributionTotal) * 100).toFixed(1) : "0.0";

        const profileUrl = buildProfileLink(cfid);
        const chartUrl = buildChart(stats);

        const distribution =
            `🔵 Brain: ${brain} (${calc(brain)}%)\n` +
            `🟣 Head: ${head} (${calc(head)}%)\n` +
            `🔴 Torso: ${torso} (${calc(torso)}%)\n` +
            `🟠 Arms: ${arms} (${calc(arms)}%)\n` +
            `🟢 Legs: ${legs} (${calc(legs)}%)`;

        const embed = new EmbedBuilder()
            .setColor("#2b2d31")
            .setTitle("GrevBot Player Profile Analysis")
            .setDescription(
                `👤 **[${stats.name || cfid}](${profileUrl})**\n` +
                `🆔 \`${cfid}\``
            )
            .addFields(
                {
                    name: "📊 Total Shots Hit",
                    value: `**${totalShots}**`
                },
                {
                    name: "📈 Hit Distribution (Count / %)",
                    value: distribution
                }
            )
            .setImage(chartUrl)
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
