// ===== GLOBAL CRASH HANDLER =====
process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason);
});

const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require("discord.js");
const { REST } = require("@discordjs/rest");

const killfeedModule = require("./killfeedModule");
const alertsModule = require("./alertsModule");
const statsModule = require("./statsModule");

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

// ===== SLASH COMMAND REGISTER =====
const commands = [
    new SlashCommandBuilder()
        .setName("profile")
        .setDescription("Vis stats for spiller")
        .addStringOption(option =>
            option.setName("cfid")
                .setDescription("CF ID")
                .setRequired(true)
        )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
    try {
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        console.log("Slash command registered");
    } catch (error) {
        console.error(error);
    }
})();

client.on("clientReady", () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// ===== SLASH HANDLER =====
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "profile") {
        await statsModule.handleProfile(interaction);
    }
});

client.on("messageCreate", async (msg) => {
    try {
        if (msg.author.id === client.user.id) return;
        if (msg.channel.id !== INPUT_CHANNEL_ID) return;

        const content = msg.content;

        const isKill = content.includes("got killed by");
        const isHit = content.includes("got hit by");

        if (isHit) {
            const hit = killfeedModule.parseHit
                ? killfeedModule.parseHit(content)
                : null;

            if (hit) {
                try {
                    await statsModule.handleStats(hit);
                } catch (err) {
                    console.error("Stats error:", err);
                }
            }
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
