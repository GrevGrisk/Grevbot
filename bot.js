// ===== GLOBAL CRASH HANDLER =====
process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason);
});

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

// ===== parse KILL =====
function parseKill(text) {
    const match = text.match(/(.+?) got killed by (.+?) \((.+?),\s*([\d.]+)m\)/i);
    if (!match) return null;

    return {
        victimName: match[1].trim(),
        victimLink: null,
        killerName: match[2].trim(),
        killerLink: null,
        weapon: match[3].trim(),
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

        let outputChannel = null;
        let alertChannel = null;

        try {
            outputChannel = await client.channels.fetch(OUTPUT_CHANNEL_ID);
        } catch (err) {
            console.error("Output channel fetch failed:", err);
        }

        try {
            alertChannel = await client.channels.fetch(ALERT_CHANNEL_ID);
        } catch (err) {
            console.error("Alert channel fetch failed:", err);
        }

        const now = new Date();
        const time = now.toLocaleString("no-NO");

        const hit = parseHit(content);
        const kill = parseKill(content);

        if (hit) {
            console.log("PARSED HIT:", hit.killerName, hit.zone);
        }

        // ================= HIT =================
        if (hit) {

            if (EXCLUDED_WEAPONS.includes(hit.weapon)) return;
            if (parseFloat(hit.distance) < 5) return;

            if (alertChannel) {
                await alertsModule.handleAlerts(
                    hit,
                    alertChannel,
                    coordsKiller,
                    coordsVictim,
                    zKiller,
                    time
                );
            }

            lastHit.set(hit.victimName.toLowerCase(), {
                damage: hit.damage,
                zone: hit.zone
            });

            if (outputChannel) {
                await killfeedModule.sendHitEmbed({
                    outputChannel,
                    hit,
                    coordsKiller,
                    coordsVictim,
                    zKiller,
                    zVictim,
                    time
                });
            }

            (async () => {
                try {
                    if (alertChannel) {
                        await statsModule.handleStats(hit, alertChannel, coordsKiller, zKiller);
                    }
                } catch (err) {
                    console.error("Stats error:", err);
                }
            })();

            return;
        }

        // ================= KILL =================
        if (kill && outputChannel) {
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
        console.error("MESSAGE ERROR:", err);
    }
});

client.login(TOKEN);

// ===== KEEP ALIVE =====
const http = require("http");

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
}).listen(PORT, () => {
    console.log("Keep-alive running on port", PORT);
});

// SAFE ping
setInterval(() => {
    try {
        http.get(`http://localhost:${PORT}`, () => {})
            .on("error", () => {});
    } catch {}
}, 30000);
