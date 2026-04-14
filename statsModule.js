const { EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");

// ===== DB (fail-safe) =====
let pool = null;

if (process.env.DATABASE_URL) {
    try {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: false
        });
        console.log("✅ DB connected");
    } catch (err) {
        console.log("⚠️ DB failed, fallback to memory");
        pool = null;
    }
}

// ===== memory fallback =====
const playerStats = new Map();

// ===== extract CF ID =====
function extractId(link) {
    if (!link) return null;
    const match = link.match(/profile\/([^/]+)/);
    return match ? match[1] : null;
}

// ===== normalize hitzones =====
function normalizeZone(zone) {
    if (!zone) return null;

    zone = zone.toLowerCase();

    if (zone.includes("brain")) return "brain";
    if (zone.includes("head")) return "head";
    if (zone.includes("left arm")) return "left_arm";
    if (zone.includes("right arm")) return "right_arm";
    if (zone.includes("left leg")) return "left_leg";
    if (zone.includes("right leg")) return "right_leg";
    if (zone.includes("torso") || zone.includes("body")) return "torso";

    return null;
}

// ===== helpers =====
function percent(count, total) {
    return total === 0 ? "0.0" : ((count / total) * 100).toFixed(1);
}

function buildChart(stats) {
    return `https://quickchart.io/chart?c={
        type:'pie',
        data:{
            labels:['Brain','Head','Torso','Left arm','Right arm','Left leg','Right leg'],
            datasets:[{
                data:[
                    ${stats.brain},
                    ${stats.head},
                    ${stats.torso},
                    ${stats.left_arm},
                    ${stats.right_arm},
                    ${stats.left_leg},
                    ${stats.right_leg}
                ]
            }]
        }
    }`;
}

// ===== default stats =====
function createEmptyStats() {
    return {
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

// ===== MAIN FUNCTION =====
async function handleStats(hit, alertChannel, coordsKiller, zKiller) {
    try {
        const id = extractId(hit.killerLink);
        const key = id ? id : hit.killerName.toLowerCase();

        let stats;

        const zone = normalizeZone(hit.zone);

        // ===== DB MODE =====
        if (pool) {
            const res = await pool.query(
                "SELECT * FROM player_stats WHERE player = $1",
                [key]
            );

            if (res.rows.length === 0) {
                await pool.query(
                    `INSERT INTO player_stats 
                    (player, brain, head, torso, left_arm, right_arm, left_leg, right_leg, total)
                    VALUES ($1,0,0,0,0,0,0,0,0)`,
                    [key]
                );

                stats = createEmptyStats();
            } else {
                stats = res.rows[0];
            }

            stats.total++;

            if (zone && stats[zone] !== undefined) {
                stats[zone]++;
            }

            await pool.query(
                `UPDATE player_stats SET
                    brain=$1,
                    head=$2,
                    torso=$3,
                    left_arm=$4,
                    right_arm=$5,
                    left_leg=$6,
                    right_leg=$7,
                    total=$8
                 WHERE player=$9`,
                [
                    stats.brain,
                    stats.head,
                    stats.torso,
                    stats.left_arm,
                    stats.right_arm,
                    stats.left_leg,
                    stats.right_leg,
                    stats.total,
                    key
                ]
            );
        }

        // ===== MEMORY MODE =====
        else {
            if (!playerStats.has(key)) {
                playerStats.set(key, createEmptyStats());
            }

            stats = playerStats.get(key);

            stats.total++;

            if (zone && stats[zone] !== undefined) {
                stats[zone]++;
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
`Brain: ${stats.brain} (${percent(stats.brain, stats.total)}%)
Head: ${stats.head} (${percent(stats.head, stats.total)}%)
Torso: ${stats.torso} (${percent(stats.torso, stats.total)}%)
Left arm: ${stats.left_arm} (${percent(stats.left_arm, stats.total)}%)
Right arm: ${stats.right_arm} (${percent(stats.right_arm, stats.total)}%)
Left leg: ${stats.left_leg} (${percent(stats.left_leg, stats.total)}%)
Right leg: ${stats.right_leg} (${percent(stats.right_leg, stats.total)})`
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
