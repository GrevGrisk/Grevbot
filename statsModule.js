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

async function handleStats(hit) {
    try {
        const killerId = extractCFID(hit.killerLink);
        if (!killerId) return;

        const zone = hit.zone;

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
            INSERT INTO player_stats (player, ${column}, total)
            VALUES ($1, 1, 1)
            ON CONFLICT (player)
            DO UPDATE SET
                ${column} = player_stats.${column} + 1,
                total = player_stats.total + 1
        `, [killerId]);

    } catch (err) {
        console.error("Stats DB error:", err);
    }
}

async function getStatsById(cfid) {
    const res = await pool.query(
        "SELECT * FROM player_stats WHERE player = $1",
        [cfid]
    );
    return res.rows[0];
}

function buildChart(stats) {
    const data = [
        stats.brain || 0,
        stats.head || 0,
        stats.torso || 0,
        (stats.left_arm || 0) + (stats.right_arm || 0),
        (stats.left_leg || 0) + (stats.right_leg || 0)
    ];

    const chartConfig = {
        type: "pie",
        data: {
            labels: ["Brain", "Head", "Torso", "Arms", "Legs"],
            datasets: [{
                data,
                backgroundColor: [
                    "#4FC3F7",
                    "#9575CD",
                    "#F06292",
                    "#FFB74D",
                    "#4DB6AC"
                ]
            }]
        }
    };

    return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
}

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

        const calc = (v) => total > 0 ? ((v / total) * 100).toFixed(1) : "0.0";

        const brain = stats.brain || 0;
        const head = stats.head || 0;
        const torso = stats.torso || 0;
        const arms = (stats.left_arm || 0) + (stats.right_arm || 0);
        const legs = (stats.left_leg || 0) + (stats.right_leg || 0);

        const profileUrl = buildProfileLink(cfid);
        const chartUrl = buildChart(stats);

        const table =
`\`\`\`
Brain : ${brain} (${calc(brain)}%)
Head  : ${head} (${calc(head)}%)
Torso : ${torso} (${calc(torso)}%)
Arms  : ${arms} (${calc(arms)}%)
Legs  : ${legs} (${calc(legs)}%)
\`\`\``;

        const embed = new EmbedBuilder()
            .setColor("#2f3136")
            .setTitle("📊 Player Profile")
            .setDescription(
                `**👤 Player**\n` +
                `➡️ [Open CFtools Profile](${profileUrl})\n` +
                `\`${cfid}\``
            )
            .addFields(
                {
                    name: "📊 Total Shots Hit",
                    value: `\n**${total}**`,
                    inline: false
                },
                {
                    name: "📈 Hit Distribution (Count / %)",
                    value: table,
                    inline: false
                }
            )
            .setImage(chartUrl)
            .setFooter({ text: "Stats Overview" });

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
