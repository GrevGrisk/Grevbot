const { Client, GatewayIntentBits } = require("discord.js");
const statsModule = require("./statsModule");
const killfeedModule = require("./killfeedModule");
const alertsModule = require("./alertsModule");

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
        const alertChannel = await client.channels.fetch(ALERT_CHANNEL_ID);

        const now = new Date();
        const time = now.toLocaleString("no-NO");

        const hit = parseHit(content);
        const kill = parseKill(content);

        // ================= HIT =================
        if (hit) {

            if (EXCLUDED_WEAPONS.includes(hit.weapon)) return;
            if (parseFloat(hit.distance) < 5) return;

            // 🔥 Alerts (nå modul)
            await alertsModule.handleAlerts(
                hit,
                alertChannel,
                coordsKiller,
                coordsVictim,
                zKiller,
                time
            );

            // 🔥 lastHit (brukes av kill)
            lastHit.set(hit.victimName.toLowerCase(), {
                damage: hit.damage,
                zone: hit.zone
            });

            // 🔥 Killfeed
            await killfeedModule.sendHitEmbed({
                outputChannel,
                hit,
                coordsKiller,
                coordsVictim,
                zKiller,
                zVictim,
                time
            });

            // 🔥 Stats (isolert)
            (async () => {
                try {
                    await statsModule.handleStats(hit, alertChannel, coordsKiller, zKiller);
                } catch {}
            })();

            return;
        }

        // ================= KILL =================
        if (kill) {
            const last = lastHit.get(kill.victimName.toLowerCase()) || {};

            await killfeedModule.sendKillEmbed({
                outputChannel,
                kill,
                last,
                coordsKiller,
                coordsVictim,
                zKiller,
                zVictim,
                time
            });
        }

    } catch (err) {
        console.error("ERROR:", err);
    }
});

client.login(TOKEN);

// 🔥 HTTP KEEP ALIVE (Railway fix)
const http = require("http");

http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot is running");
}).listen(process.env.PORT || 3000);
