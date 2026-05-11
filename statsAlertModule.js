const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

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
const acknowledgedPlayers = new Map();
const alertSnapshots = new Map();

const ALERT_WINDOW = 60 * 60 * 1000;
const ACK_DURATION = 7 * 24 * 60 * 60 * 1000;

const FORCE_ALERT_INCREASE = {
    brain: 2,
    head: 5,
    torso: 8,
    total: 100
};

function buildProfileLink(cfid) {
    return `https://app.cftools.cloud/profile/${cfid}`;
}

function acknowledgePlayer(cfid, checkedBy = "Unknown") {
    const snapshot = alertSnapshots.get(cfid);

    acknowledgedPlayers.set(cfid, {
        time: Date.now(),
        checkedBy,
        brain: snapshot?.brain || 0,
        head: snapshot?.head || 0,
        torso: snapshot?.torso || 0,
        total: snapshot?.total || 0
    });
}

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

async function handleAlertInteraction(interaction) {
    if (!interaction.isButton()) return;

    if (!interaction.customId.startsWith("ack_player:")) return;

    const cfid = interaction.customId.split(":")[1];

    acknowledgePlayer(cfid, interaction.user.tag);

    await interaction.deferReply({ ephemeral: true });

    await interaction.editReply({
        content: `✅ Player muted for 7 days.\nCFID: \`${cfid}\``
    });

    await interaction.message.edit({
        components: []
    });
}

// ===== MAIN =====
async function checkPlayer(client, hit, stats) {
    try {
        if (!stats) return;

        const isTest = hit?.isTest;

        if (!isTest && (hit.weapon || "").toLowerCase().includes("tridagger")) return;

        const isShotgun = SHOTGUNS.some(w =>
            (hit.weapon || "").toLowerCase().includes(w.toLowerCase())
        );

        if (!isTest && isShotgun && (hit.distance || 0) < 30) return;

        const brain = stats.brain || 0;
        const head = stats.head || 0;
        const torso = stats.torso || 0;
        const arms = (stats.left_arm || 0) + (stats.right_arm || 0);
        const legs = (stats.left_leg || 0) + (stats.right_leg || 0);

        const total = brain + head + torso + arms + legs;

        if (!isTest && total < 75) return;

        const pct = (v) => (total > 0 ? (v / total) * 100 : 0);

        const brainPct = pct(brain);
        const headPct = pct(head);
        const torsoPct = pct(torso);

        const ack = acknowledgedPlayers.get(stats.player);

        if (!isTest && ack) {
            const expired = (Date.now() - ack.time) > ACK_DURATION;

            if (expired) {
                acknowledgedPlayers.delete(stats.player);
            } else {
                const brainIncrease = brainPct - ack.brain;
                const headIncrease = headPct - ack.head;
                const torsoIncrease = torsoPct - ack.torso;
                const totalIncrease = total - ack.total;

                const drasticChange =
                    brainIncrease >= FORCE_ALERT_INCREASE.brain ||
                    headIncrease >= FORCE_ALERT_INCREASE.head ||
                    torsoIncrease >= FORCE_ALERT_INCREASE.torso ||
                    totalIncrease >= FORCE_ALERT_INCREASE.total;

                if (!drasticChange) {
                    return;
                }
            }
        }

        let reason = null;

        if (brainPct > 3) {
            reason = "This player has an elevated brainhit pattern";
        } else if (headPct > 20) {
            reason = "This player has an elevated headshot pattern";
        } else if (torsoPct > 80) {
            reason = "This player has an abnormal torso hit pattern";
        }

        if (!reason && !isTest) return;

        const now = Date.now();
        const prev = playerAlerts.get(stats.player);

        if (!isTest && prev) {
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

        if (isTest) {
            reason = "This is a test alert";
        }

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

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ack_player:${stats.player}`)
                .setLabel("PC Checked / Mute 7 Days")
                .setStyle(ButtonStyle.Success)
                .setEmoji("✅")
        );

        for (const id of ALERT_CHANNEL_IDS) {
            try {
                const channel = await client.channels.fetch(id);
                if (channel) {
                    await channel.send({
                        embeds: [embed],
                        components: [row]
                    });
                }
            } catch (err) {
                console.error(err);
            }
        }

        playerAlerts.set(stats.player, {
            time: now,
            brain: brainPct,
            head: headPct,
            torso: torsoPct
        });

        alertSnapshots.set(stats.player, {
            brain: brainPct,
            head: headPct,
            torso: torsoPct,
            total: total
        });

    } catch (err) {
        console.error("Alert error:", err);
    }
}

module.exports = {
    checkPlayer,
    handleAlertInteraction,
    acknowledgePlayer
};
