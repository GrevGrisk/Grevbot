const { EmbedBuilder } = require("discord.js");

/*
========================================
⚙️ ALERT CHANNEL SETUP
========================================
*/
const ALERT_CHANNEL_IDS = [
    "1493801257838710814"
];
/*
========================================
*/

const SHOTGUNS = [
    "M870",
    "R12",
    "SPAS-12",
    "Serbu Super-Shorty"
];

const playerAlerts = new Map();
const ALERT_WINDOW = 60 * 60 * 1000;

function buildProfileLink(cfid) {
    return `https://app.cftools.cloud/profile/${cfid}`;
}

// ===== CHART (samme som før - ikke rør) =====
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
                    fontSize: 16
                }
            },
            plugins: {
                datalabels: {
                    color: "#000000",
                    backgroundColor: "#ffffff",
                    borderRadius: 4,
                    padding: 4,
                    font: {
                        size: 16,
                        weight: "bold"
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

        if ((hit.weapon || "").toLowerCase().includes("tridagger")) return;

        const isShotgun = SHOTGUNS.some(w =>
            (hit.weapon || "").toLowerCase().includes(w.toLowerCase())
        );

        if (isShotgun && (hit.distance || 0) < 30) return;

        const brain = stats.brain || 0;
        const head = stats.head || 0;
        const torso = stats.torso || 0;
        const arms = (stats.left_arm || 0) + (stats.right_arm || 0);
        const legs = (stats.left_leg || 0) + (stats.right_leg || 0);

        const total = brain + head + torso + arms + legs;
        if (total < 30) return;

        const pct = (v) => (total > 0 ? (v / total) * 100 : 0);

        const brainPct = pct(brain);
        const headPct = pct(head);
        const torsoPct = pct(torso);

        let reason = null;

        if (brainPct > 3) {
            reason = "Elevated brain hit pattern";
        } else if (headPct > 20) {
            reason = "Elevated headshot pattern";
        } else if (torsoPct > 80) {
            reason = "Abnormal torso hit pattern";
        }

        if (!reason) return;

        const now = Date.now();
        const prev = playerAlerts.get(stats.player);

        if (prev) {
            const withinWindow = (now - prev.time) < ALERT_WINDOW;

            if (withinWindow) {
                const brainIncrease = brainPct - prev.brain;
                const headIncrease = headPct - prev.head;
                const torsoIncrease = torsoPct - prev.torso;

                if (
                    brainIncrease < 1 &&
                    headIncrease < 2 &&
                    torsoIncrease < 3
                ) {
                    return;
                }
            }
        }

        // ===== CLEAN EMBED (slik du hadde det) =====
        const embed = new EmbedBuilder()
            .setColor("#ff1744")
            .setTitle("🚨 Grevbot Alert 🚨")
            .setDescription(
                `⚠️ Suspicious hit pattern detected\n\n` +
                `${reason}\n\n` +
                `👤 **${stats.name || stats.player}**\n` +
                `[Open Profile](${buildProfileLink(stats.player)})\n\n` +
                `🆔 \`${stats.player}\``
            )
            .setImage(buildChart(stats))
            .setFooter({
                text: "GrevBot statsalert 2026"
            });

        for (const id of ALERT_CHANNEL_IDS) {
            try {
                const channel = await client.channels.fetch(id);
                if (channel) {
                    await channel.send({ embeds: [embed] });
                }
            } catch (err) {
                console.error(`Failed to send alert to ${id}:`, err.message);
            }
        }

        playerAlerts.set(stats.player, {
            time: now,
            brain: brainPct,
            head: headPct,
            torso: torsoPct
        });

    } catch (err) {
        console.error("Alert error:", err);
    }
}

module.exports = {
    checkPlayer
};
