const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

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

const lastHit = new Map();

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

client.on("clientReady", () => {
    console.log(`Logged in as ${client.user.tag}`);
});

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

        const now = new Date();
        const time = now.toLocaleString("no-NO", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });

        const hit = parseHit(content);
        const kill = parseKill(content);

        // ================= HIT =================
        if (hit) {
            lastHit.set(hit.victimName, {
                damage: hit.damage,
                zone: hit.zone
            });

            const shotLink =
                coordsKiller && coordsVictim
                    ? `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(hit.weapon)}&dist=${hit.distance}&dmg=${hit.damage}&hit=${hit.zone}`
                    : null;

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .addFields(
                    {
                        name: "Killer",
                        value: `[${hit.killerName}](${hit.killerLink})`,
                        inline: true
                    },
                    {
                        name: "Victim",
                        value: `[${hit.victimName}](${hit.victimLink})`,
                        inline: true
                    },

                    { name: "Weapon", value: hit.weapon },
                    { name: "Hitzone", value: hit.zone },

                    { name: "Distance", value: `${hit.distance} m`, inline: true },
                    { name: "Damage", value: `${hit.damage}`, inline: true },

                    {
                        name: "Killer Coordinates",
                        value: `${coordsKiller?.x}, ${zKiller}, ${coordsKiller?.y}`,
                        inline: true
                    },
                    {
                        name: "Victim Coordinates",
                        value: `${coordsVictim?.x}, ${zVictim}, ${coordsVictim?.y}`,
                        inline: true
                    },

                    { name: "Map", value: shotLink ? `[View in map](${shotLink})` : "-" },
                    { name: "Time", value: `🕒 ${time}` }
                )
                .setFooter({ text: "GrevGrisk - Line-of-sight" });

            await outputChannel.send({ embeds: [embed] });
            return;
        }

        // ================= KILL =================
        if (kill) {
            const last = lastHit.get(kill.victimName);

            const shotLink =
                coordsKiller && coordsVictim
                    ? `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(kill.weapon)}&dist=${kill.distance}&dmg=${last?.damage || ""}&hit=${last?.zone || ""}`
                    : null;

            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .addFields(
                    {
                        name: "Killer",
                        value: `[${kill.killerName}](${kill.killerLink})`,
                        inline: true
                    },
                    {
                        name: "Victim",
                        value: `[${kill.victimName}](${kill.victimLink})`,
                        inline: true
                    },

                    { name: "Weapon", value: kill.weapon },

                    { name: "Hitzone", value: last?.zone || "-", inline: true },
                    { name: "Damage", value: last?.damage || "-", inline: true },

                    { name: "Distance", value: `${kill.distance} m` },

                    {
                        name: "Killer Coordinates",
                        value: `${coordsKiller?.x}, ${zKiller}, ${coordsKiller?.y}`,
                        inline: true
                    },
                    {
                        name: "Victim Coordinates",
                        value: `${coordsVictim?.x}, ${zVictim}, ${coordsVictim?.y}`,
                        inline: true
                    },

                    { name: "Map", value: shotLink ? `[View in map](${shotLink})` : "-" },
                    { name: "Time", value: `🕒 ${time}` }
                )
                .setFooter({ text: "GrevGrisk - Line-of-sight" });

            await outputChannel.send({ embeds: [embed] });
        }

    } catch (err) {
        console.error("ERROR:", err);
    }
});

client.login(TOKEN);

// holder Railway oppe
require("http").createServer(() => {}).listen(3000);
