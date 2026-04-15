const { EmbedBuilder } = require("discord.js");

// ===== HIT (GRØNN) =====
async function sendHitEmbed({ outputChannel, hit, coordsKiller, coordsVictim, zKiller, zVictim, time }) {
    const mapLink =
        coordsKiller && coordsVictim
            ? `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(hit.weapon)}&dist=${hit.distance}&dmg=${hit.damage}&hit=${hit.zone}`
            : null;

    const embed = new EmbedBuilder()
        .setColor(0x00ff00) // 🟢 HIT = GRØNN
        .setTitle("Grevbot Line-of-sight analysis")
        .addFields(
            { name: "Killer", value: hit.killerLink ? `[${hit.killerName}](${hit.killerLink})` : hit.killerName, inline: true },
            { name: "Victim", value: hit.victimLink ? `[${hit.victimName}](${hit.victimLink})` : hit.victimName, inline: true },
            { name: "Weapon", value: hit.weapon },
            { name: "Hitzone", value: hit.zone || "-" , inline: true },
            { name: "Damage", value: hit.damage || "-", inline: true },
            { name: "Distance", value: `${hit.distance} m`, inline: true },
            { name: "Killer Coordinates", value: coordsKiller ? `${coordsKiller.x}, ${zKiller}, ${coordsKiller.y}` : "-" },
            { name: "Victim Coordinates", value: coordsVictim ? `${coordsVictim.x}, ${zVictim}, ${coordsVictim.y}` : "-" },
            { name: "Map", value: mapLink ? `[View in map](${mapLink})` : "-" },
            { name: "Time", value: time }
        );

    await outputChannel.send({ embeds: [embed] });
}

// ===== KILL (RØD) =====
async function sendKillEmbed({ outputChannel, kill, last, coordsKiller, coordsVictim, zKiller, zVictim, time }) {
    const mapLink =
        coordsKiller && coordsVictim
            ? `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(kill.weapon)}&dist=${kill.distance}&dmg=${last.damage}&hit=${last.zone}`
            : null;

    const embed = new EmbedBuilder()
        .setColor(0xff0000) // 🔴 KILL = RØD
        .setTitle("Grevbot Line-of-sight analysis")
        .addFields(
            { name: "Killer", value: kill.killerLink ? `[${kill.killerName}](${kill.killerLink})` : kill.killerName, inline: true },
            { name: "Victim", value: kill.victimLink ? `[${kill.victimName}](${kill.victimLink})` : kill.victimName, inline: true },
            { name: "Weapon", value: kill.weapon },
            { name: "Hitzone", value: last?.zone || "-", inline: true },
            { name: "Damage", value: last?.damage || "-", inline: true },
            { name: "Distance", value: `${kill.distance} m`, inline: true },
            { name: "Killer Coordinates", value: coordsKiller ? `${coordsKiller.x}, ${zKiller}, ${coordsKiller.y}` : "-" },
            { name: "Victim Coordinates", value: coordsVictim ? `${coordsVictim.x}, ${zVictim}, ${coordsVictim.y}` : "-" },
            { name: "Map", value: mapLink ? `[View in map](${mapLink})` : "-" },
            { name: "Time", value: time }
        );

    await outputChannel.send({ embeds: [embed] });
}

module.exports = {
    sendHitEmbed,
    sendKillEmbed
};
