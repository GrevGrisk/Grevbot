const { EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");
const https = require("https");

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

function fetchText(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            let data = "";

            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                resolve(data);
            });
        });

        req.on("error", reject);
        req.setTimeout(5000, () => {
            req.destroy(new Error("Request timeout"));
        });
    });
}

async function fetchPlayerName(cfid) {
    try {
        const html = await fetchText(buildProfileLink(cfid));

        const ogTitle =
            html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
            html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);

        if (ogTitle && ogTitle[1]) {
            const title = ogTitle[1].trim();
            if (title) return title.replace(/\s*\|\s*CFTOOLS.*$/i, "").trim();
        }

        const titleTag = html.match(/<title>([^<]+)<\/title>/i);
        if (titleTag && titleTag[1]) {
            const title = titleTag[1].trim();
            if (title) return title.replace(/\s*\|\s*CFTOOLS.*$/i, "").trim();
        }

        return cfid;
    } catch (err) {
        console.error("Player name fetch error:", err);
        return cfid;
    }
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
                borderColor: "#EAEAEA",
                borderWidth: 2
            }]
        },
        options: {
            layout: {
                padding: {
                    top: 10,
                    bottom: 10,
                    left: 10,
                    right: 10
                }
            },
            plugins: {
                legend: {
                    position: "top",
                    labels: {
                        color: "#F5F5F5",
                        boxWidth: 28,
                        boxHeight: 12,
                        font: {
                            size: 16,
                            weight: "bold"
                        }
                    }
                },
                datalabels: {
                    color: "#111111",
                    font: {
                        size: 20,
                        weight: "bold"
                    },
                    formatter: (value) => value > 0 ? value : ""
                }
            }
        }
    };

    return `https://quickchart.io/chart?width=700&height=520&backgroundColor=transparent&devicePixelRatio=2&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
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

        const playerName = await fetchPlayerName(cfid);
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
            `🔵 **Brain:** ${brain} (${calc(brain)}%)\n` +
            `🟣 **Head:** ${head} (${calc(head)}%)\n` +
            `🔴 **Torso:** ${torso} (${calc(torso)}%)\n` +
            `🟠 **Arms:** ${arms} (${calc(arms)}%)\n` +
            `🟢 **Legs:** ${legs} (${calc(legs)}%)`;

        if (other > 0) {
            distribution += `\n⚪ **Other:** ${other} (${calc(other)}%)`;
        }

        const embed = new EmbedBuilder()
            .setColor("#2b2d31")
            .setTitle("GrevBot Player Profile Analysis")
            .setDescription(
                `👤 **[${playerName}](${profileUrl})**\n` +
                `🆔 \`${cfid}\``
            )
            .addFields(
                {
                    name: "📊 Total Shots Hit",
                    value: `**${total}**`,
                    inline: false
                },
                {
                    name: "📈 Hit Distribution (Count / %)",
                    value: distribution,
                    inline: false
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
