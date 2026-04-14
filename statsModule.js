const { EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");

// ===== DB (fail-safe) =====
let pool = null;

if (process.env.DATABASE_URL) {
    try {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        console.log("✅ DB connected");
    } catch (err) {
        console.log("⚠️ DB failed, fallback to memory");
        pool = null;
    }
}

// ===== memory fallback =====
const playerStats = new Map();

// ===== helpers =====
function percent(count, total) {
    return total === 0 ? "0.0" : ((count / total) * 100).toFixed(1);
}

function buildChart(stats) {
    return `https://quickchart.io/chart?c={
        type:'pie',
        data:{
            labels:['Brain','Head','Torso','Arms','Legs'],
            datasets:[{
                data:[${stats.brain},${stats.head},${stats.torso},${stats.arms},${stats.legs}]
            }]
        }
    }`;
}

// ===== MAIN FUNCTION =====
async function handleStats(hit, alertChannel, coordsKiller, zKiller) {
    try {
        const key = hit.killerName.toLowerCase();

        let stats;

        // ===== DB MODE =====
        if (pool) {
            const res = await pool.query(
                "SELECT * FROM player_stats WHERE player = $1",
                [key]
            );

            if (res.rows.length === 0) {
                await pool.query(
                    "INSERT INTO player_stats (player) VALUES ($1)",
                    [key]
                );

                stats = {
                    brain: 0,
                    head: 0,
                    torso: 0,
                    arms: 0,
                    legs: 0,
                    total: 0
                };
            } else {
                stats = res.rows[0];
            }

            stats.total++;

            if (stats[hit.zone] !== undefined) {
                stats[hit.zone]++;
            }

            await pool.query(
                `UPDATE player_stats
                 SET brain=$1, head=$2, torso=$3, arms=$4, legs=$5, total=$6
                 WHERE player=$7`,
                [
                    stats.brain,
                    stats.head,
                    stats.torso,
                    stats.arms,
                    stats.legs,
                    stats.total,
                    key
                ]
            );
        }

        // ===== MEMORY MODE =====
        else {
            if (!playerStats.has(key)) {
                playerStats.set(key, {
                    brain: 0,
                    head: 0,
                    torso: 0,
                    arms: 0,
                    legs: 0,
                    total: 0
                });
            }

            stats = playerStats.get(key);

            stats.total++;

            if (stats[hit.zone] !== undefined) {
                stats[hit.zone]++;
            }
        }

        // ===== ALERT LOGIC =====
        if (stats.total < 20) return;

        const upper = stats.brain + stats.head;
        const ratio = upper / stats.total;

        if (ratio < 0.4) return;

        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("⚠️ SUSPICIOUS PATTERN DETECTED")
            .setDescription(`Player is consistently hitting upper hitbox (${(ratio * 100).toFixed(1)}%).`)
            .addFields(
                { name: "Player", value: `[${hit.killerName}](${hit.killerLink})` },
                { name: "Total Hits", value: `${stats.total}` },
                {
                    name: "Distribution",
                    value:
`Brain : ${stats.brain} (${percent(stats.brain, stats.total)}%)
Head  : ${stats.head} (${percent(stats.head, stats.total)}%)
Torso : ${stats.torso} (${percent(stats.torso, stats.total)}%)
Arms  : ${stats.arms} (${percent(stats.arms, stats.total)}%)
Legs  : ${stats.legs} (${percent(stats.legs, stats.total)})`
                },
                {
                    name: "Coordinates",
                    value: `${coordsKiller?.x}, ${zKiller}, ${coordsKiller?.y}`
                }
            )
            .setImage(buildChart(stats))
            .setFooter({ text: "GrevGrisk - Line-of-sight" });

        await alertChannel.send({ embeds: [embed] });

    } catch (err) {
        console.error("Stats module error:", err);
    }
}

module.exports = {
    handleStats
};
