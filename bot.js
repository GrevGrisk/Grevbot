// ===== GLOBAL CRASH HANDLER =====
process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason);
});

const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require("discord.js");
const { REST } = require("@discordjs/rest");

const pool = require("./db"); // 🔥 endret

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

        let outputChannel = null;

        try { outputChannel = await client.channels.fetch(OUTPUT_CHANNEL_ID); } catch {}

        const isKill = content.includes("got killed by");
        let kill = null;

        if (isKill) kill = parseKill(content);

        if (kill && outputChannel) {

            const victimCFID = kill.victimLink?.split("/").pop();
            const killerCFID = kill.killerLink?.split("/").pop();

            try {
                await pool.query(`
                    INSERT INTO player_deaths
                    (victim, victim_name, killer, killer_name, weapon, distance, x, y)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [
                    victimCFID,
                    kill.victimName,
                    killerCFID,
                    kill.killerName,
                    kill.weapon,
                    kill.distance,
                    coordsVictim?.x || null,
                    coordsVictim?.y || null
                ]);
            } catch (err) {
                console.error("Death insert error:", err);
            }

            await killfeedModule.sendKillEmbed({
                outputChannel,
                kill
            });
        }

    } catch (err) {
        console.error("MESSAGE ERROR:", err);
    }
});

client.login(TOKEN);
