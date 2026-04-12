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

function getCoords(text, type) {
    const match = text.match(new RegExp(`${type}:\\s*<X:\\s*([\\d.]+),\\s*Y:\\s*([\\d.]+)`));
    if (!match) return null;
    return { x: match[1], y: match[2] };
}

function getZ(text, type) {
    const match = text.match(new RegExp(`${type}:.*Z:\\s*([\\d.]+)`));
    return match ? match[1] : "0";
}

function parseProfile(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\[${escaped}\\]\\(<https://app\\.cftools\\.cloud/profile/([^>]+)>\\)`);
    const match = null;
    return regex;
}

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
        // blokker kun egen bot, ikke webhook/integration
        if (msg.author.id === client.user.id) return;
        if (msg.channel.id !== INPUT_CHANNEL_ID) return;

        const content = msg.content;
        const outputChannel = await client.channels.fetch(OUTPUT_CHANNEL_ID);

        const coordsVictim = getCoords(content, "Victim");
        const coordsKiller = getCoords(content, "Killer");
        const zVictim = getZ(content, "Victim");
        const zKiller = getZ(content, "Killer");

        const now = new Date();
        const time = now.toLocaleString("en-GB", {
            timeZone: "Europe/London",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });

        const shotLink =
            coordsKiller && coordsVictim
                ? `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}`
                : null;

        const hit = parseHit(content);
        if (hit) {
            lastHit.set(hit.victimName, {
                killerName: hit.killerName,
                damage: hit.damage,
                zone: hit.zone
            });

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle("Grevbot - Line-of-sight")
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
                    {
                        name: "Weapon",
                        value: hit.weapon,
                        inline: false
                    },
                    {
                        name: "Hitzone",
                        value: hit.zone,
                        inline: true
                    },
                    {
                        name: "Distance",
                        value: `${hit.distance} m`,
                        inline: true
                    },
                    {
                        name: "Damage",
                        value: `${hit.damage}`,
                        inline: true
                    },
                    {
                        name: "Maplink",
                        value: shotLink ? `[View in map](${shotLink})` : "-",
                        inline: false
                    },
                    {
                        name: "Date and time",
                        value: time,
                        inline: false
                    }
                )
                .setFooter({ text: "GrevGrisk - Line-of-sight" });

            if (coordsKiller) {
                embed.addFields({
                    name: "Killer Coordinates",
                    value: `${coordsKiller.x}, ${zKiller}, ${coordsKiller.y}`,
                    inline: false
                });
            }

            if (coordsVictim) {
                embed.addFields({
                    name: "Victim Coordinates",
                    value: `${coordsVictim.x}, ${zVictim}, ${coordsVictim.y}`,
                    inline: false
                });
            }

            await outputChannel.send({ embeds: [embed] });
            return;
        }

        const kill = parseKill(content);
        if (kill) {
            const last = lastHit.get(kill.victimName);

            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle("Grevbot - Line-of-sight")
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
                    {
                        name: "Weapon",
                        value: kill.weapon,
                        inline: false
                    },
                    {
                        name: "Hitzone",
                        value: last?.zone || "-",
                        inline: true
                    },
                    {
                        name: "Distance",
                        value: `${kill.distance} m`,
                        inline: true
                    },
                    {
                        name: "Damage",
                        value: last?.damage || "-",
                        inline: true
                    },
                    {
                        name: "Maplink",
                        value: shotLink ? `[View in map](${shotLink})` : "-",
                        inline: false
                    },
                    {
                        name: "Date and time",
                        value: time,
                        inline: false
                    }
                )
                .setFooter({ text: "GrevGrisk - Line-of-sight" });

            if (coordsKiller) {
                embed.addFields({
                    name: "Killer Coordinates",
                    value: `${coordsKiller.x}, ${zKiller}, ${coordsKiller.y}`,
                    inline: false
                });
            }

            if (coordsVictim) {
                embed.addFields({
                    name: "Victim Coordinates",
                    value: `${coordsVictim.x}, ${zVictim}, ${coordsVictim.y}`,
                    inline: false
                });
            }

            await outputChannel.send({ embeds: [embed] });
        }

    } catch (err) {
        console.error("ERROR:", err);
    }
});

client.login(TOKEN);
require("http").createServer(() => {}).listen(3000);
