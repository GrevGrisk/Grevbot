const { EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ===== CFID EXTRACT =====
function extractCFID(link) {
    if (!link) return null;
    const parts = link.split("/");
    return parts[parts.length - 1];
}

// ===== PROFILE LINK =====
function buildProfileLink(cfid) {
    return `https://app.cftools.cloud/profile/${cfid}`;
}

// ===== HANDLE STATS =====
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
            INSERT INTO player_stats (player, name, ${column}, total)
            VALUES ($1, $2, 1, 1)
            ON CONFLICT (player)
            DO UPDATE SET
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

// ===== BUILD CHART URL =====
function buildChart(stats) {
    const data = [
        stats.brain || 0,
        stats.head || 0,
        stats.torso || 0,
        stats.left_arm || 0,
        stats.right_arm || 0,
        stats.left_leg || 0,
        stats.right_leg || 0
    ];

    const chartConfig = {
        type: "pie",
        data: {
            labels: ["Brain", "Head", "Torso", "L Arm", "R Arm", "L Leg", "R Leg"],
            datasets: [{
                data,
                backgroundColor: [
                    "#ff0000",
                    "#ff6666",
                    "#ffa500",
                    "#00bfff",
                    "#1e90ff",
                    "#32cd32",
                    "#228b22"
                ]
            }]
        }
    };

    return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
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

        const percent = (value) =>
            total > 0 ? ((value / total) * 100).toFixed(1) : 0;

        const chartUrl = buildChart(stats);
        const profileUrl = buildProfileLink(cfid);

        const embed = new EmbedBuilder()
            .setTitle(`Profile: [${stats.name || cfid}](${profileUrl})`)
            .setDescription(`CFID: \`${cfid}\``)
            .addFields(
                { name: "Total Hits", value: String(total) },
                {
                    name: "Distribution",
                    value:
                        `Brain: ${stats.brain} (${percent(stats.brain)}%)\n` +
                        `Head: ${stats.head} (${percent(stats.head)}%)\n` +
                        `Torso: ${stats.torso} (${percent(stats.torso)}%)\n` +
                        `Left arm: ${stats.left_arm} (${percent(stats.left_arm)}%)\n` +
                        `Right arm: ${stats.right_arm} (${percent(stats.right_arm)}%)\n` +
                        `Left leg: ${stats.left_leg} (${percent(stats.left_leg)}%)\n` +
                        `Right leg: ${stats.right_leg} (${percent(stats.right_leg)}%)`
                }
            )
            .setImage(chartUrl);

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
