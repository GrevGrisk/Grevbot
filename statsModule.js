const { EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ===== HANDLE STATS (HIT EVENTS) =====
async function handleStats(hit) {
    try {
        const killerId = hit.killerLink;
        const victimId = hit.victimLink;

        if (!killerId || !victimId) return;

        // killer stats
        await pool.query(`
            INSERT INTO player_stats (cfid, name, kills, headshots)
            VALUES ($1, $2, 1, $3)
            ON CONFLICT (cfid)
            DO UPDATE SET
                kills = player_stats.kills + 1,
                headshots = player_stats.headshots + $3
        `, [
            killerId,
            hit.killerName,
            hit.zone === "head" ? 1 : 0
        ]);

        // victim stats
        await pool.query(`
            INSERT INTO player_stats (cfid, name, deaths)
            VALUES ($1, $2, 1)
            ON CONFLICT (cfid)
            DO UPDATE SET
                deaths = player_stats.deaths + 1
        `, [
            victimId,
            hit.victimName
        ]);

    } catch (err) {
        console.error("Stats DB error:", err);
    }
}

// ===== GET PROFILE =====
async function getStatsById(cfid) {
    const res = await pool.query(
        "SELECT * FROM player_stats WHERE cfid = $1",
        [cfid]
    );
    return res.rows[0];
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

        const kd = stats.deaths > 0
            ? (stats.kills / stats.deaths).toFixed(2)
            : stats.kills;

        const embed = new EmbedBuilder()
            .setTitle(`Profile: ${stats.name || cfid}`)
            .addFields(
                { name: "Kills", value: String(stats.kills || 0), inline: true },
                { name: "Deaths", value: String(stats.deaths || 0), inline: true },
                { name: "K/D", value: String(kd), inline: true },
                { name: "Headshots", value: String(stats.headshots || 0), inline: true }
            );

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
