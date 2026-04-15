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
    const total = stats.total || 0;

    const shownTotal = brain + head + torso + arms + legs;
    const other = Math.max(0, total - shownTotal);

    const labels = ["Brain", "Head", "Torso", "Arms", "Legs"];
    const data = [brain, head, torso, arms, legs];
    const colors = ["#4FC3F7", "#9575CD", "#F06292", "#FFB74D", "#4DB6AC"];

    if (other > 0) {
        labels.push("Other");
        data.push(other);
        colors.push("#B0BEC5");
    }

    const chartConfig = {
        type: "pie",
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderColor: "#1e1e1e",
                borderWidth: 2
            }]
        },
        options: {
            plugins: {
                legend: {
                    position: "top",
                    labels: {
                        color: "#ffffff",
                        font: {
                            size: 18,
                            weight: "bold"
                        },
                        padding: 20
                    }
                }
            }
        }
    };

    return `https://quickchart.io/chart?width=800&height=600&backgroundColor=transparent&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
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

        const total = stats.total || 0;

        const brain = stats.brain || 0;
        const head = stats.head || 0;
        const torso = stats.torso || 0;
        const arms = (stats.left_arm || 0) + (stats.right_arm || 0);
        const legs = (stats.left_leg || 0) + (stats.right_leg || 0);

        const shownTotal = brain + head + torso + arms + legs;
        const other = Math.max(0, total - shownTotal);

        const calc = (v) => total > 0 ? ((v / total) * 100).toFixed(1) : "0.0";

        const profileUrl = buildProfileLink(cfid);
        const chartUrl = buildChart(stats);

        let distribution =
            `🔵 Brain: ${brain} (${calc(brain)}%)\n` +
            `🟣 Head: ${head} (${calc(head)}%)\n` +
            `🔴 Torso: ${torso} (${calc(torso)}%)\n` +
            `🟠 Arms: ${arms} (${calc(arms)}%)\n` +
            `🟢 Legs: ${legs} (${calc(legs)}%)`;

        if (other > 0) {
            distribution += `\n⚪ Other: ${other} (${calc(other)}%)`;
        }

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
                    value: `**${total}**`
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
