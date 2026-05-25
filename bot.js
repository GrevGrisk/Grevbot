// ===== GLOBAL CRASH HANDLER =====
process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason);
});

const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require("discord.js");
const { REST } = require("@discordjs/rest");
const crypto = require("crypto");

const pool = require("./db");

const killfeedModule = require("./killfeedModule");
const alertsModule = require("./alertsModule");
const statsModule = require("./statsModule");
const statsAlert = require("./statsAlertModule");
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

// ===== ALT DETECTOR DATABASE HELPERS =====
function hashIP(ip) {
    if (!process.env.IP_HASH_SECRET) {
        console.error("Missing IP_HASH_SECRET environment variable");
        return null;
    }

    return crypto
        .createHash("sha256")
        .update(ip + process.env.IP_HASH_SECRET)
        .digest("hex");
}

async function storeAltPlayerIP({
    steam64,
    cftools_id,
    beguid,
    player_name,
    ip,
    server_id
}) {
    if (!steam64 || !ip) return;

    const ipHash = hashIP(ip);
    if (!ipHash) return;

    let playerId = null;

    try {
        const existingPlayer = await pool.query(`
            SELECT id FROM alt_players
            WHERE steam64 = $1
            LIMIT 1
        `, [steam64]);

        if (existingPlayer.rows.length > 0) {
            playerId = existingPlayer.rows[0].id;

            await pool.query(`
                UPDATE alt_players
                SET cftools_id = $1,
                    beguid = $2,
                    last_name = $3
                WHERE id = $4
            `, [
                cftools_id || null,
                beguid || null,
                player_name || null,
                playerId
            ]);
        } else {
            const newPlayer = await pool.query(`
                INSERT INTO alt_players
                (steam64, cftools_id, beguid, last_name, created_at)
                VALUES ($1, $2, $3, $4, CURRENT_DATE)
                RETURNING id
            `, [
                steam64,
                cftools_id || null,
                beguid || null,
                player_name || null
            ]);

            playerId = newPlayer.rows[0].id;
        }
    } catch (err) {
        console.error("Alt player insert/update error:", err);
        return;
    }

    try {
        const existingLink = await pool.query(`
            SELECT id, seen_count FROM alt_ip_links
            WHERE player_id = $1
              AND ip_hash = $2
              AND server_id = $3
            LIMIT 1
        `, [
            playerId,
            ipHash,
            server_id || null
        ]);

        if (existingLink.rows.length > 0) {
            await pool.query(`
                UPDATE alt_ip_links
                SET last_seen = CURRENT_DATE,
                    seen_count = seen_count + 1
                WHERE id = $1
            `, [existingLink.rows[0].id]);
        } else {
            await pool.query(`
                INSERT INTO alt_ip_links
                (player_id, ip_hash, server_id, first_seen, last_seen, seen_count)
                VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE, 1)
            `, [
                playerId,
                ipHash,
                server_id || null
            ]);
        }
    } catch (err) {
        console.error("Alt IP link insert/update error:", err);
    }
}

async function findAltMatchesByIP(ip) {
    const ipHash = hashIP(ip);
    if (!ipHash) return [];

    try {
        const result = await pool.query(`
            SELECT 
                ap.id,
                ap.steam64,
                ap.cftools_id,
                ap.beguid,
                ap.last_name,
                ail.server_id,
                ail.first_seen,
                ail.last_seen,
                ail.seen_count
            FROM alt_ip_links ail
            JOIN alt_players ap ON ap.id = ail.player_id
            WHERE ail.ip_hash = $1
            ORDER BY ail.last_seen DESC
        `, [ipHash]);

        return result.rows;
    } catch (err) {
        console.error("Alt IP match lookup error:", err);
        return [];
    }
}

async function createAltCase({
    player_id,
    matched_player_id,
    score,
    reason
}) {
    try {
        await pool.query(`
            INSERT INTO alt_cases
            (player_id, matched_player_id, score, reason, created_at)
            VALUES ($1, $2, $3, $4, CURRENT_DATE)
        `, [
            player_id,
            matched_player_id,
            score,
            reason
        ]);
    } catch (err) {
        console.error("Alt case insert error:", err);
    }
}

// 🔥 NY: prosesser meldinger i streng rekkefølge 1:1
let processingQueue = Promise.resolve();

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
    const match = text.match(new RegExp(`${type}:\\s*<X:\\s*([\\d.]+),\\s*Y:\\s*([\\d.]+),\\s*Z:\\s*([\\d.]+)>`));
    if (!match) return null;
    return { x: match[1], y: match[2] };
}

function getZ(text, type) {
    const match = text.match(new RegExp(`${type}:\\s*<X:\\s*[\\d.]+,\\s*Y:\\s*[\\d.]+,\\s*Z:\\s*([\\d.]+)>`));
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
    if (interaction.isButton()) {
        await statsAlert.handleAlertInteraction(interaction);
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "profile") {
        await statsModule.handleProfile(interaction);
    }

    if (interaction.commandName === "testalert") {
        await testAlertCommand.execute(interaction);
    }
});

// ===== MESSAGE PROCESSOR =====
async function processInputMessage(msg) {
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

    const isHit = content.includes("got hit by");
    const isKill = content.includes("got killed by");

    // ===== HIT =====
    if (isHit) {
        const hit = parseHit(content);
        if (!hit) return;

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

        if (alertChannel) {
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
    if (isKill) {
        const kill = parseKill(content);
        if (!kill) return;

        const victimCFID = kill.victimLink?.split("/").pop();
        const killerCFID = kill.killerLink?.split("/").pop();

        try {
            await pool.query(`
                INSERT INTO player_deaths
                (victim, victim_name, killer, killer_name, weapon, distance, x, y, killer_x, killer_y)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `, [
                victimCFID,
                kill.victimName,
                killerCFID,
                kill.killerName,
                kill.weapon,
                kill.distance,
                coordsVictim?.x || null,
                coordsVictim?.y || null,
                coordsKiller?.x || null,
                coordsKiller?.y || null
            ]);
        } catch (err) {
            console.error("Death insert error:", err);
        }

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

        if (outputChannel) {
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

        return;
    }
}

// ===== MESSAGE HANDLER =====
client.on("messageCreate", (msg) => {
    processingQueue = processingQueue
        .then(() => processInputMessage(msg))
        .catch((err) => {
            console.error("MESSAGE ERROR:", err);
        });
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
