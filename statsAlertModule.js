const { EmbedBuilder } = require("discord.js");

const SHOTGUNS = [
    "M870",
    "R12",
    "SPAS-12",
    "Serbu Super-Shorty"
];

function getAlertChannels() {
    if (!process.env.ALERT_CHANNEL_IDS) return [];
    return process.env.ALERT_CHANNEL_IDS.split(",").map(id => id.trim());
}

function buildProfileLink(cfid) {
    return `https://app.cftools.cloud/profile/${cfid}`;
}

// ===== SAME CHART AS statsModule =====
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

// ===== MAIN =====
async function checkPlayer(client, hit, stats) {
    try {
        if (!stats) return;

        // ===== FILTERS =====

        if ((hit.weapon || "").toLowerCase().includes("tridagger")) return;

        const isShotgun = SHOTGUNS.some(w =>
            (hit.weapon || "").toLowerCase().includes(w.toLowerCase())
        );

        if (isShotgun && (hit.distance || 0) < 30) return;

        // ===== CALC =====

        const brain = stats.brain || 0;
        const head = stats.head || 0;
        const torso = stats.torso || 0;
        const arms = (stats.left_arm || 0) + (stats.right_arm || 0);
        const legs = (stats.left_leg || 0) + (stats.right_leg || 0);

        const total = brain + head + torso + arms + legs;

        if (total < 30) return;

        const pct = (v) => (total > 0 ? (v / total) * 100 : 0);

        const headPct = pct(head);
        const brainPct = pct(brain);
        const torsoPct = pct(torso);

        let reason = null;

        if (brainPct > 3) {
            reason = "This player has an elevated brainhit pattern";
        } else if (headPct > 20) {
            reason = "This player has an elevated headshot pattern";
        } else if (torsoPct > 80) {
            reason = "This player has an abnormal torso hit pattern";
        }

        if (!reason) return;

        // ===== EMBED =====

        const embed = new EmbedBuilder()
            .setColor("#ff3d00")
            .setTitle("🚨 Grevbot Alert 🚨")
            .setDescription(
                `⚠️ Suspicious hit pattern Detected !! ⚠️\n\n` +
                `${reason}\n\n` +
                `👤 **${stats.name || stats.player}**\n` +
                `[Open Profile](${buildProfileLink(stats.player)})\n\n` +
                `🆔 \`${stats.player}\``
            )
            .addFields(
                {
                    name: "📊 Total Shots Hit",
                    value: `**${total}**`
                },
                {
                    name: "📈 Hit Distribution (Count / %)",
                    value:
                        `🔵 Brain: ${brain} (${brainPct.toFixed(1)}%)\n` +
                        `🟣 Head: ${head} (${headPct.toFixed(1)}%)\n` +
                        `🔴 Torso: ${torso} (${torsoPct.toFixed(1)}%)\n` +
                        `🟠 Arms: ${arms} (${pct(arms).toFixed(1)}%)\n` +
                        `🟢 Legs: ${legs} (${pct(legs).toFixed(1)}%)`
                }
            )
            .setImage(buildChart(stats))
            .setFooter({
                text: "GrevBot statsalert 2026"
            });

        // ===== SEND =====

        const channels = getAlertChannels();

        for (const id of channels) {
            try {
                const channel = await client.channels.fetch(id);
                if (channel) {
                    await channel.send({ embeds: [embed] });
                }
            } catch (err) {
                console.error(`Alert send failed (${id}):`, err.message);
            }
        }

    } catch (err) {
        console.error("Alert error:", err);
    }
}

module.exports = {
    checkPlayer
};
