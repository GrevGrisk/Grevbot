const { EmbedBuilder } = require("discord.js");

const playerStats = new Map();

// ===== update stats =====
function updateStats(hit) {
    const key = hit.killerName.toLowerCase();

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

    const stats = playerStats.get(key);

    stats.total++;

    if (stats[hit.zone]) {
        stats[hit.zone]++;
    }

    return stats;
}

// ===== percent =====
function percent(count, total) {
    return total === 0 ? "0.0" : ((count / total) * 100).toFixed(1);
}

// ===== chart =====
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

// ===== alert =====
async function maybeSendStatsAlert(hit, stats, alertChannel, coordsKiller, zKiller) {

    // minimum data før vi bryr oss
    if (stats.total < 20) return;

    const upper = stats.brain + stats.head;
    const ratio = upper / stats.total;

    if (ratio < 0.4) return;

    const chartUrl = buildChart(stats);

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
        .setImage(chartUrl)
        .setFooter({ text: "GrevGrisk - Line-of-sight" });

    await alertChannel.send({ embeds: [embed] });
}

module.exports = {
    updateStats,
    maybeSendStatsAlert
};
