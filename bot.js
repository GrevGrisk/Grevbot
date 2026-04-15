// ===== GLOBAL CRASH HANDLER =====
process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason);
});

const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require("discord.js");
const { REST } = require("@discordjs/rest");

// 🔥 DB connection
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const killfeedModule = require("./killfeedModule");
const alertsModule = require("./alertsModule");
const statsModule = require("./statsModule");
const testAlertCommand = require("./testalert");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const INPUT_CHANNEL_ID = "1483550858099560502";
const OUTPUT_CHANNEL_ID = "1492666634190454864";
const ALERT_CHANNEL_ID = "1478757145288900679";

const EXCLUDED_WEAPONS = ["TriDagger"];

const lastHit = new Map();

// ===== COMMANDS =====
const commands = [
    new SlashCommandBuilder()
        .setName("profile")
        .setDescription("Vis stats for spiller")
        .addStringOption(option =>
            option.setName("cfid")
                .setDescription("CF ID")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("testalert")
        .setDescription("Trigger a test GrevBot alert")

].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

// ===== READY =====
client.on("clientReady", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    for (const [id] of client.guilds.cache) {
        try {
            await rest.put(
                Routes.applicationGuildCommands(CLIENT_ID, id),
                { body: commands }
            );
        } catch (err) {
            console.error(err);
        }
    }
});

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

    const rawVictim = match[1].trim();
    const rawKiller = match[2].trim();

    const victimMatch = rawVictim.match(/\[(.*?)\]\(<(.*?)>\)/);
    const killerMatch = rawKiller.match(/\[(.*?)\]\(<(.*?)>\)/);

    return {
        victimName: victimMatch ? victimMatch[1] : rawVictim,
        victimLink: victimMatch ? victimMatch[2] : null,
        killerName: killerMatch ? killerMatch[1] : rawKiller,
        killerLink: killerMatch ? killerMatch[2] : null,
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

    const rawVictim = match[1].trim();
    const rawKiller = match[2].trim();

    const victimMatch = rawVictim.match(/\[(.*?)\]\(<(.*?)>\)/);
    const killerMatch = rawKiller.match(/\[(.*?)\]\(<(.*?)>\)/);

    return {
        victimName: victimMatch ? victimMatch[1] : rawVictim,
        victimLink: victimMatch ? victimMatch[2] : null,
        killerName: killerMatch ? killerMatch[1] : rawKiller,
        killerLink: killerMatch ? killerMatch[2] : null,
        weapon: match[3].trim(),
        distance: match[4]
    };
}

// ===== SLASH HANDLER =====
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "profile") {
        await statsModule.handleProfile(interaction);
    }

    if (interaction.commandName === "testalert") {
        await testAlertCommand.execute(interaction);
    }
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

        try { outputChannel = await client.channels.fetch(OUTPUT_CHANNEL_ID); } catch {}
        try { alertChannel = await client.channels.fetch(ALERT_CHANNEL_ID); } catch {}

        const now = new Date();
        const time = now.toLocaleString("no-NO");

        const isKill = content.includes("got killed by");
        const isHit = content.includes("got hit by");

        let hit = null;
        let kill = null;

        if (isKill) kill = parseKill(content);
        else if (isHit) hit = parseHit(content);

        // ===== HIT =====
        if (hit) {
            const key = hit.victimName.toLowerCase();

            if (!lastHit.has(key)) {
                lastHit.set(key, []);
            }

            lastHit.get(key).push({
                distance: hit.distance,
                damage: hit.damage,
                zone: hit.zone,
                time: Date.now()
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

            const isFiltered =
                EXCLUDED_WEAPONS.includes(hit.weapon) ||
                parseFloat(hit.distance) < 5;

            if (!isFiltered && alertChannel) {
                try {
                    await alertsModule.handleAlerts(
                        hit,
                        alertChannel,
                        coordsKiller,
                        coordsVictim,
                        zKiller,
                        time
                    );
                } catch (err) {
                    console.error("Alerts error:", err);
                }

                try {
                    await statsModule.handleStats(client, hit);
                } catch (err) {
                    console.error("Stats error:", err);
                }
            }

            return;
        }

        // ===== KILL =====
        if (kill && outputChannel) {
            const key = kill.victimName.toLowerCase();
            const killTime = Date.now();

            let last = { damage: "-", zone: "-" };

            if (lastHit.has(key)) {
                const hits = lastHit.get(key);

                const exact = hits.filter(h => h.distance === kill.distance);

                if (exact.length > 0) {
                    const before = exact
                        .filter(h => h.time <= killTime)
                        .sort((a, b) => b.time - a.time);

                    if (before.length > 0) {
                        last = before[0];
                    }
                }
            }

            // 🔥 lagre death
            const victimCFID = kill.victimLink?.split("/").pop();
            const killerCFID = kill.killerLink?.split("/").pop();

            try {
                await pool.query(`
                    INSERT INTO player_deaths
                    (victim, victim_name, killer, killer_name, weapon, distance)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                    victimCFID,
                    kill.victimName,
                    killerCFID,
                    kill.killerName,
                    kill.weapon,
                    kill.distance
                ]);
            } catch (err) {
                console.error("Death insert error:", err);
            }

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
const https = require("https");

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = "https://grevbot-production.up.railway.app";

http.createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
}).listen(PORT);

setInterval(() => {
    https.get(PUBLIC_URL, () => {}).on("error", () => {});
}, 25000);

setInterval(() => {
    console.log("BOT STILL RUNNING", new Date().toISOString());
}, 10000);
