const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const statsModule = require("./statsModule");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const TOKEN = process.env.TOKEN;
const INPUT_CHANNEL_ID = "1483550858099560502";
const OUTPUT_CHANNEL_ID = "1492666634190454864";
const ALERT_CHANNEL_ID = "1478757145288900679";

const EXCLUDED_WEAPONS = ["TriDagger"];

const lastHit = new Map();
const headshotTracker = new Map();
const brainTracker = new Map();
const recentHits = new Map();

// ===== coords =====
function getCoords(text, type) {
    const match = text.match(new RegExp(`${type}:\\s*<X:\\s*([\\d.]+),\\s*Y:\\s*([\\d.]+)`));
    if (!match) return null;
    return { x: match[1], y: match[2] };
}

function getZ(text, type) {
    const match = text.match(new RegExp(`${type}:.*Z:\\s*([\\d.]+)`));
    return match ? match[1] : "0";
}

// ===== store hits =====
function storeRecentHit(hit) {
    const now = Date.now();
    const key = hit.killerName.toLowerCase();

    if (!recentHits.has(key)) {
        recentHits.set(key, []);
    }

    const hits = recentHits.get(key);

    hits.push({
        victim: hit.victimName,
        link: hit.victimLink,
        weapon: hit.weapon,
        zone: hit.zone,
        distance: hit.distance,
        time: now
    });

    const recent = hits.filter(h => now - h.time <= 10000);
    recentHits.set(key, recent);

    return recent;
}

// ===== headshot tracking =====
function trackHeadshotsAdvanced(killerName) {
    const now = Date.now();
    const key = killerName.toLowerCase();

    if (!headshotTracker.has(key)) {
        headshotTracker.set(key, []);
    }

    const hits = headshotTracker.get(key);
    hits.push(now);

    const recent30min = hits.filter(t => now - t <= 30 * 60 * 1000);
    headshotTracker.set(key, recent30min);

    return {
        count5s: recent30min.filter(t => now - t <= 5000).length,
        count10s: recent30min.filter(t => now - t <= 10000).length,
        count30min: recent30min.length
    };
}

// ===== brain tracking =====
function trackBrainHits(killerName) {
    const now = Date.now();
    const key = killerName.toLowerCase();

    if (!brainTracker.has(key)) {
        brainTracker.set(key, []);
    }

    const hits = brainTracker.get(key);
    hits.push(now);

    const recent = hits.filter(t => now - t <= 10 * 60 * 1000);
    brainTracker.set(key, recent);

    return recent.length;
}

// ===== parse HIT =====
function parseHit(text) {
    const match = text.match(/\[(.*?)\]\(<(.*?)>\)\s+got hit by\s+\[(.*?)\]\(<(.*?)>\)\s+\((.*?),\s*([\d.]+)m,\s*([\d.]+)\s*damage,\s*hitzone\s*(\w+)\)/i);
    if (!match) return null;

    return {
        victimName: match[1],
        victimLink: match[2],
        killerName: match[3],
        killerLink: match[4],
        weapon: match[5],
        distance: match[6],
        damage: match[7],
        zone: match[8]
    };
}

// ===== parse KILL =====
function parseKill(text) {
    const match = text.match(/\[(.*?)\]\(<(.*?)>\)\s+got killed by\s+\[(.*?)\]\(<(.*?)>\)\s+\((.*?),\s*([\d.]+)m\)/i);
    if (!match) return null;

    return {
        victimName: match[1],
        victimLink: match[2],
        killerName: match[3],
        killerLink: match[4],
        weapon: match[5],
        distance: match[6]
    };
}

// ===== register slash command =====
async function registerCommands() {
    try {
        if (!client.application) return;

        const commands = [
            new SlashCommandBuilder()
                .setName("profile")
                .setDescription("Show player hitzone stats")
                .addStringOption(option =>
                    option
                        .setName("id")
                        .setDescription("CF Tools profile ID")
                        .setRequired(true)
                )
                .toJSON()
        ];

        await client.application.commands.set(commands);
        console.log("✅ Slash commands registered");
    } catch (err) {
        console.error("❌ Slash command error:", err);
    }
}

client.on("clientReady", async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await registerCommands();
});

// ===== slash command handler =====
client.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== "profile") return;

        if (typeof statsModule.getStatsById !== "function") {
            return interaction.reply({ content: "Stats not ready.", ephemeral: true });
        }

        const id = interaction.options.getString("id");
        const stats = await statsModule.getStatsById(id);

        if (!stats) {
            return interaction.reply({
                content: `No stats found for ID: ${id}`,
                ephemeral: true
            });
        }

        const total = Number(stats.total || 0);
        const percent = (c) => total === 0 ? "0.0" : ((Number(c || 0) / total) * 100).toFixed(1);

        const embed = new EmbedBuilder()
            .setColor(0x00ffcc)
            .setTitle("📊 Player Profile")
            .setDescription(`Stats for ID: ${id}`)
            .addFields(
                { name: "Total Hits", value: `${total}` },
                {
                    name: "Distribution",
                    value:
`Brain: ${stats.brain || 0} (${percent(stats.brain)}%)
Head: ${stats.head || 0} (${percent(stats.head)}%)
Torso: ${stats.torso || 0} (${percent(stats.torso)}%)
Left arm: ${stats.left_arm || 0} (${percent(stats.left_arm)}%)
Right arm: ${stats.right_arm || 0} (${percent(stats.right_arm)}%)
Left leg: ${stats.left_leg || 0} (${percent(stats.left_leg)}%)
Right leg: ${stats.right_leg || 0} (${percent(stats.right_leg)}%)`
                }
            )
            .setImage(statsModule.buildChart(stats));

        await interaction.reply({ embeds: [embed] });

    } catch (err) {
        console.error("Command error:", err);
    }
});

// ===== ORIGINAL MESSAGE HANDLER (UNCHANGED) =====
client.on("messageCreate", async (msg) => {
    try {
        if (msg.author.id === client.user.id) return;
        if (msg.channel.id !== INPUT_CHANNEL_ID) return;

        const content = msg.content;

        const coordsVictim = getCoords(content, "Victim");
        const coordsKiller = getCoords(content, "Killer");
        const zVictim = getZ(content, "Victim");
        const zKiller = getZ(content, "Killer");

        const outputChannel = await client.channels.fetch(OUTPUT_CHANNEL_ID);
        const alertChannel = await client.channels.fetch(ALERT_CHANNEL_ID);

        const now = new Date();
        const time = now.toLocaleString("no-NO");

        const hit = parseHit(content);
        const kill = parseKill(content);

        if (hit) {
            if (EXCLUDED_WEAPONS.includes(hit.weapon)) return;
            if (parseFloat(hit.distance) < 5) return;

            const victims = storeRecentHit(hit);

            if (hit.zone.toLowerCase() === "head") {
                const stats = trackHeadshotsAdvanced(hit.killerName);

                let triggered = false;
                let message = "";

                if (stats.count5s === 3) {
                    triggered = true;
                    message = `Has hit ${stats.count5s} headshots within 5 seconds`;
                }

                if (stats.count10s === 5) {
                    triggered = true;
                    message = `Has hit ${stats.count10s} headshots within 10 seconds`;
                }

                if (stats.count30min === 10) {
                    triggered = true;
                    message = `Has hit ${stats.count30min} headshots within 30 minutes`;
                }

                if (triggered) {
                    const alertEmbed = new EmbedBuilder()
                        .setColor(0xff0000)
                        .setTitle("Grevbot Alert!")
                        .setDescription("⚠️ Suspicious Activity detected !!! ⚠️")
                        .addFields(
                            { name: "Player", value: `[${hit.killerName}](${hit.killerLink})` },
                            { name: "Activity", value: message }
                        );

                    await alertChannel.send({ embeds: [alertEmbed] });
                }
            }

            await outputChannel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x00ff00)
                        .setDescription(`${hit.killerName} → ${hit.victimName}`)
                ]
            });

            (async () => {
                try {
                    await statsModule.handleStats(hit, alertChannel, coordsKiller, zKiller);
                } catch {}
            })();

            return;
        }

    } catch (err) {
        console.error("ERROR:", err);
    }
});

client.login(TOKEN);
require("http").createServer(() => {}).listen(3000);
