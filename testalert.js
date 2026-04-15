const { SlashCommandBuilder } = require("discord.js");
const statsAlert = require("./statsAlertModule");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("testalert")
        .setDescription("Trigger test alert"),

    async execute(interaction) {
        const fakeStats = {
            player: "test123",
            name: "TestPlayer",
            brain: 5,
            head: 10,
            torso: 20,
            left_arm: 2,
            right_arm: 2,
            left_leg: 1,
            right_leg: 1
        };

        await statsAlert.checkPlayer(interaction.client, {
            isTest: true
        }, fakeStats);

        await interaction.reply({
            content: "Test alert sent",
            ephemeral: true
        });
    }
};
