const { SlashCommandBuilder } = require("discord.js");
const statsAlert = require("./statsAlertModule"); // samme mappe som bot.js

module.exports = {
    data: new SlashCommandBuilder()
        .setName("testalert")
        .setDescription("Trigger a test GrevBot alert"),

    async execute(interaction) {
        try {
            // 🔥 fake hit (ikke shotgun / ikke tridagger)
            const fakeHit = {
                weapon: "AKM",
                distance: 100
            };

            // 🔥 fake stats (over 30 hits + trigger conditions)
            const fakeStats = {
                player: "test123",
                name: "TestPlayer",
                brain: 2,        // >3%
                head: 10,        // >20%
                torso: 25,       // høy torso
                left_arm: 0,
                right_arm: 0,
                left_leg: 0,
                right_leg: 0
            };

            // 🔥 trigger alert
            await statsAlert.checkPlayer(interaction.client, fakeHit, fakeStats);

            await interaction.reply({
                content: "🚨 Test alert sent!",
                ephemeral: true
            });

        } catch (err) {
            console.error("Test alert error:", err);

            await interaction.reply({
                content: "❌ Failed to send test alert",
                ephemeral: true
            });
        }
    }
};
