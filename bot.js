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
const axios = require("axios");

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

// ===== ALT DETECTOR HELPERS =====
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
    if (!steam64 || !ip) return false;

    const ipHash = hashIP(ip);
    if (!ipHash) return false;

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
        return false;
    }

    try {
        const existingLink = await pool.query(`
            SELECT id FROM alt_ip_links
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

        return true;
    } catch (err) {
        console.error("Alt IP link insert/update error:", err);
        return false;
    }
}

async function getCFToolsToken() {
    const response = await axios.post(
        "https://data.cftools.cloud/v1/auth/register",
        {
            application_id: process.env.CFTOOLS_APP_ID,
            secret: process.env.CFTOOLS_APP_SECRET
        },
        {
            headers: {
                "User-Agent": process.env.CFTOOLS_APP_ID
            }
        }
    );

    return response.data.token;
}

async function getCFToolsGSMList() {
    const token = await getCFToolsToken();

    const response = await axios.get(
        `https://data.cftools.cloud/v1/server/${process.env.CFTOOLS_SERVER_API_ID}/GSM/list`,
        {
            headers: {
                "User-Agent": process.env.CFTOOLS_APP_ID,
                "Authorization": `Bearer ${token}`
            }
        }
    );

    return response.data;
}

// ===== QUEUE =====
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
        .setDescription("Trigger a test GrevBot alert"),

    new SlashCommandBuilder()
        .setName("cftest")
        .setDescription("Test CF Tools API"),

    new SlashCommandBuilder()
        .setName("cflist")
        .setDescription("Test CF Tools GSM player list"),

    new SlashCommandBuilder()
        .setName("cfsync")
        .setDescription("Sync active CF Tools players to alt detector database"),

    new SlashCommandBuilder()
        .setName("cfplayer")
        .setDescription("Test CF Tools player endpoint")
        .addStringOption(option =>
            option.setName("cftools_id")
                .setDescription("CFTools ID")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("cfbans")
        .setDescription("Test CF Tools banlist endpoint")
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

    if (interaction.commandName === "cftest") {
        await interaction.deferReply({ ephemeral: true });

        try {
            const token = await getCFToolsToken();

            console.log("CF Tools token received:", token ? "YES" : "NO");

            await interaction.editReply("CF Tools API connected successfully.");
        } catch (err) {
            console.error("CF Tools API test failed:", err.response?.data || err.message || err);
            await interaction.editReply("CF Tools API failed. Check Railway logs.");
        }
    }

    if (interaction.commandName === "cflist") {
        await interaction.deferReply({ ephemeral: true });

        try {
            const list = await getCFToolsGSMList();
            const players = Array.isArray(list) ? list : (list.sessions || list.players || list.data || []);

            console.log("===== CF TOOLS GSM LIST SUMMARY =====");
            console.log("CF Tools GSM list count:", players.length);

            if (players.length > 0) {
                console.log("Sample player fields:", Object.keys(players[0]));
                console.log("Sample gamedata:", players[0].gamedata);
                console.log("Sample connection fields:", Object.keys(players[0].connection || {}));
            }

            await interaction.editReply(`CF Tools GSM list fetched. Players found: ${players.length}. Check Railway logs.`);
        } catch (err) {
            console.error("CF Tools GSM list failed:", err.response?.data || err.message || err);
            await interaction.editReply("CF Tools GSM list failed. Check Railway logs.");
        }
    }

    if (interaction.commandName === "cfsync") {
        await interaction.deferReply({ ephemeral: true });

        try {
            const list = await getCFToolsGSMList();

            const players = Array.isArray(list) ? list : (list.sessions || list.players || list.data || []);

            let found = 0;
            let saved = 0;
            let skipped = 0;

            for (const player of players) {
                const steam64 = player?.gamedata?.steam64;
                const playerName = player?.gamedata?.player_name || player?.persona?.profile?.name || null;
                const cftoolsId = player?.cftools_id || null;
                const beguid = player?.gamedata?.beguid || player?.gamedata?.be_guid || null;
                const ip = player?.connection?.ipv4;

                if (!steam64 || !ip) {
                    skipped++;
                    continue;
                }

                found++;

                const ok = await storeAltPlayerIP({
                    steam64,
                    cftools_id: cftoolsId,
                    beguid,
                    player_name: playerName,
                    ip,
                    server_id: process.env.CFTOOLS_SERVER_API_ID
                });

                if (ok) saved++;
            }

            await interaction.editReply(
                `CF sync complete.\nFound: ${found}\nSaved: ${saved}\nSkipped: ${skipped}`
            );
        } catch (err) {
            console.error("CF sync failed:", err.response?.data || err.message || err);
            await interaction.editReply("CF sync failed. Check Railway logs.");
        }
    }

    if (interaction.commandName === "cfplayer") {
        await interaction.deferReply({ ephemeral: true });

        try {
            const cftoolsId = interaction.options.getString("cftools_id");
            const token = await getCFToolsToken();

            const response = await axios.get(
                `https://data.cftools.cloud/v2/server/${process.env.CFTOOLS_SERVER_API_ID}/player`,
                {
                    headers: {
                        "User-Agent": process.env.CFTOOLS_APP_ID,
                        "Authorization": `Bearer ${token}`
                    },
                    params: {
                        cftools_id: cftoolsId
                    }
                }
            );

            console.log("===== CF TOOLS PLAYER RESPONSE =====");
            console.log(JSON.stringify(response.data, null, 2));

            await interaction.editReply("CF Tools player data fetched. Check Railway logs.");
        } catch (err) {
            console.error("CF Tools player lookup failed:", err.response?.data || err.message || err);
            await interaction.editReply("CF Tools player lookup failed. Check Railway logs.");
        }
    }

    if (interaction.commandName === "cfbans") {
        await interaction.deferReply({ ephemeral: true });

        try {
            const token = await getCFToolsToken();

            const banlists = [
                process.env.CFTOOLS_BANLIST_ID_1,
                process.env.CFTOOLS_BANLIST_ID_2
            ].filter(Boolean);

            if (banlists.length === 0) {
                await interaction.editReply("No banlist IDs configured.");
                return;
            }

            for (const banlistId of banlists) {
                const response = await axios.get(
                    `https://data.cftools.cloud/v1/banlist/${banlistId}/bans`,
                    {
                        headers: {
                            "User-Agent": process.env.CFTOOLS_APP_ID,
                            "Authorization": `Bearer ${token}`
                        }
                    }
                );

                const bans = Array.isArray(response.data)
                    ? response.data
                    : (response.data.bans || response.data.data || response.data.entries || []);

                console.log(`===== CF TOOLS BANLIST ${banlistId} SUMMARY =====`);
                console.log("Ban count:", bans.length);

                if (bans.length > 0) {
                    console.log("Sample ban keys:", Object.keys(bans[0]));
                    console.log("Sample ban entry:", JSON.stringify(bans[0], null, 2));
                }
            }

            await interaction.editReply("CF Tools banlists fetched. Check Railway logs.");
        } catch (err) {
            console.error("CF Tools banlist lookup failed:", err.response?.data || err.message || err);
            await interaction.editReply("CF Tools banlist lookup failed. Check Railway logs.");
        }
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
