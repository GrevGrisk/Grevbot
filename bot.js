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

// ===== lagrer siste hit =====
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
    const match = text.match(/\[(.*?)\].*?got hit by \[(.*?)\].*\((.*?),\s*([\d.]+)m,\s*([\d.]+)\s*damage,\s*hitzone\s*(\w+)\)/i);
    if (!match) return null;

    return {
        victim: match[1],
        killer: match[2],
        weapon: match[3],
        distance: match[4],
        damage: match[5],
        zone: match[6]
    };
}

// ===== parse KILL =====
function parseKill(text) {
    const match = text.match(/\[(.*?)\].*?got killed by \[(.*?)\].*\((.*?),\s*([\d.]+)m\)/i);
    if (!match) return null;

    return {
        victim: match[1],
        killer: match[2],
        weapon: match[3],
        distance: match[4]
    };
}

client.on("clientReady", () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (msg) => {
    try {
        if (msg.author.bot) return;
        if (msg.channel.id !== INPUT_CHANNEL_ID) return;

        const content = msg.content;

        const coordsVictim = getCoords(content, "Victim");
        const coordsKiller = getCoords(content, "Killer");
        const zVictim = getZ(content, "Victim");
        const zKiller = getZ(content, "Killer");

        const outputChannel = await client.channels.fetch(OUTPUT_CHANNEL_ID);

        // ================= HIT =================
        const hit = parseHit(content);
        if (hit) {
            lastHit.set(hit.victim, hit);

            const embed = new EmbedBuilder()
                .setColor(0x00ff00) // 🟢 grønn
                .addFields(
                    { name: "Killer", value: hit.killer, inline: true },
                    { name: "Victim", value: hit.victim, inline: true },

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
                    }
                )
                .setFooter({ text: "GrevGrisk - Line-of-sight" });

            await outputChannel.send({ embeds: [embed] });
            return;
        }

        // ================= KILL =================
        const kill = parseKill(content);
        if (kill) {
            const last = lastHit.get(kill.victim);

            const embed = new EmbedBuilder()
                .setColor(0xff0000) // 🔴 rød
                .addFields(
                    { name: "Killer", value: kill.killer, inline: true },
                    { name: "Victim", value: kill.victim, inline: true },

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
                    }
                )
                .setFooter({ text: "GrevGrisk - Line-of-sight" });

            await outputChannel.send({ embeds: [embed] });
        }

    } catch (err) {
        console.error(err);
    }
});

client.login(TOKEN);

// holder Railway oppe
require("http").createServer(() => {}).listen(3000);
