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

// ===== FIXED parse HIT =====
function parseHit(text) {
    const match = text.match(/(.+?) got hit by (.+?) \((.+?),\s*([\d.]+)m,\s*([\d.]+)\s*damage,\s*hitzone\s*(\w+)\)/i);
    if (!match) return null;

    return {
        victimName: match[1].trim(),
        victimLink: null,
        killerName: match[2].trim(),
        killerLink: null,
        weapon: match[3].trim(),
        distance: match[4],
        damage: match[5],
        zone: match[6].toLowerCase()
    };
}

// ===== parse KILL (urørt) =====
function parseKill(text) {
    const match = text.match(/(.*?) got killed by (.*?) \((.*?),\s*([\d.]+)m\)/i);
    if (!match) return null;

    return {
        victimName: match[1],
        victimLink: null,
        killerName: match[2],
        killerLink: null,
        weapon: match[3],
        distance: match[4]
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

        // DEBUG (kan fjernes senere)
        if (hit) {
            console.log("PARSED HIT:", hit.killerName, hit.zone);
        }

        // ================= HIT =================
        if (hit) {

            if (EXCLUDED_WEAPONS.includes(hit.weapon)) return;
            if (parseFloat(hit.distance) < 5) return;

            // 🔥 ALERTS
            await alertsModule.handleAlerts(
                hit,
                alertChannel,
                coordsKiller,
                coordsVictim,
                zKiller,
                time
            );

            // 🔥 last hit
            lastHit.set(hit.victimName.toLowerCase(), {
                damage: hit.damage,
                zone: hit.zone
            });

            // 🔥 killfeed
            await killfeedModule.sendHitEmbed({
                outputChannel,
                hit,
                coordsKiller,
                coordsVictim,
                zKiller,
                zVictim,
                time
            });

            // 🔥 stats
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

// ===== Railway keep alive =====
const http = require("http");

http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot is running");
}).listen(process.env.PORT || 3000);
