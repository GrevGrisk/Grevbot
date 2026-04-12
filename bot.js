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

// ===== coords =====
function getCoords(text, type) {
    const regex = new RegExp(`${type}:\\s*<X:\\s*(-?[\\d.]+),\\s*Y:\\s*(-?[\\d.]+)`);
    const match = text.match(regex);
    if (!match) return null;

    return {
        x: Math.floor(parseFloat(match[1])),
        y: Math.floor(parseFloat(match[2]))
    };
}

// ===== hent Z =====
function getZ(text, type) {
    const regex = new RegExp(`${type}:.*Z:\\s*([\\d.]+)`);
    const match = text.match(regex);
    if (!match) return 0;

    return Math.round(parseFloat(match[1]));
}

// ===== parse kill =====
function parseKill(text) {
    const match = text.match(/\[(.*?)\]\(<(.*?)>\) got killed by \[(.*?)\]\(<(.*?)>\) \(([^,]+),\s*([\d.]+)m\)/);

    if (!match) return null;

    return {
        victimName: match[1],
        victimLink: match[2],
        killerName: match[3],
        killerLink: match[4],
        weapon: match[5],
        dist: Math.round(parseFloat(match[6]))
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

        if (!content.includes("Victim:") || !content.includes("Killer:")) return;

        const coordsVictim = getCoords(content, "Victim");
        const coordsKiller = getCoords(content, "Killer");

        const zVictim = getZ(content, "Victim");
        const zKiller = getZ(content, "Killer");

        const data = parseKill(content);

        if (!coordsVictim || !coordsKiller || !data) return;

        const shotLink = `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(data.weapon)}&dist=${data.dist}`;

        // 🕒 dato + tid
        const now = new Date();
        const time = now.toLocaleString("no-NO", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });

        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .addFields(
                {
                    name: "Killer",
                    value: `[${data.killerName}](${data.killerLink})`,
                    inline: true
                },
                {
                    name: "Victim",
                    value: `[${data.victimName}](${data.victimLink})`,
                    inline: true
                },
                {
                    name: "Weapon",
                    value: data.weapon,
                    inline: false
                },
                {
                    name: "Distance",
                    value: `${data.dist} m`,
                    inline: false
                },
                {
                    name: "Killer Coordinates",
                    value: `${coordsKiller.x}, ${zKiller}, ${coordsKiller.y}`,
                    inline: true
                },
                {
                    name: "Victim Coordinates",
                    value: `${coordsVictim.x}, ${zVictim}, ${coordsVictim.y}`,
                    inline: true
                },
                {
                    name: "Map",
                    value: `[View in map](${shotLink})`,
                    inline: false
                },
                {
                    name: "Time",
                    value: `🕒 ${time}`,
                    inline: false
                }
            )
            .setFooter({ text: "GrevGrisk - Line-of-sight" });

        const outputChannel = await client.channels.fetch(OUTPUT_CHANNEL_ID);

        await outputChannel.send({
            embeds: [embed]
        });

    } catch (err) {
        console.error("ERROR:", err);
    }
});

client.login(TOKEN);

// 🔥 holder Railway live
require("http").createServer(() => {}).listen(3000);
