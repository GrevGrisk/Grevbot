const { EmbedBuilder } = require("discord.js");

function buildShotLink({ coordsKiller, coordsVictim, weapon, distance, damage, zone }) {
    if (!coordsKiller || !coordsVictim) return null;

    return `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(weapon)}&dist=${distance}&dmg=${damage || ""}&hit=${zone || ""}`;
}

async function sendHitEmbed({
    outputChannel,
    hit,
    coordsKiller,
    coordsVictim,
    zKiller,
    zVictim,
    time
}) {
    const shotLink = buildShotLink({
        coordsKiller,
        coordsVictim,
        weapon: hit.weapon,
        distance: hit.distance,
        damage: hit.damage,
        zone: hit.zone
    });

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .addFields(
            { name: "Killer", value: `[${hit.killerName}](${hit.killerLink})`, inline: true },
            { name: "Victim", value: `[${hit.victimName}](${hit.victimLink})`, inline: true },
            { name: "Weapon", value: hit.weapon },
            { name: "Hitzone", value: hit.zone },
            { name: "Distance", value: `${hit.distance} m`, inline: true },
            { name: "Damage", value: `${hit.damage}`, inline: true },
            { name: "Killer Coordinates", value: `${coordsKiller?.x}, ${zKiller}, ${coordsKiller?.y}`, inline: true },
            { name: "Victim Coordinates", value: `${coordsVictim?.x}, ${zVictim}, ${coordsVictim?.y}`, inline: true },
            { name: "Map", value: shotLink ? `[View in map](${shotLink})` : "-" },
            { name: "Time", value: `🕒 ${time}` }
        );

    await outputChannel.send({ embeds: [embed] });
}

async function sendKillEmbed({
    outputChannel,
    kill,
    last,
    coordsKiller,
    coordsVictim,
    zKiller,
    zVictim,
    time
}) {
    const shotLink = buildShotLink({
        coordsKiller,
        coordsVictim,
        weapon: kill.weapon,
        distance: kill.distance,
        damage: last.damage || "",
        zone: last.zone || ""
    });

    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .addFields(
            { name: "Killer", value: `[${kill.killerName}](${kill.killerLink})`, inline: true },
            { name: "Victim", value: `[${kill.victimName}](${kill.victimLink})`, inline: true },
            { name: "Weapon", value: kill.weapon },
            { name: "Hitzone", value: last.zone || "-", inline: true },
            { name: "Damage", value: last.damage || "-", inline: true },
            { name: "Distance", value: `${kill.distance} m` },
            { name: "Killer Coordinates", value: `${coordsKiller?.x}, ${zKiller}, ${coordsKiller?.y}`, inline: true },
            { name: "Victim Coordinates", value: `${coordsVictim?.x}, ${zVictim}, ${coordsVictim?.y}`, inline: true },
            { name: "Map", value: shotLink ? `[View in map](${shotLink})` : "-" },
            { name: "Time", value: `🕒 ${time}` }
        );

    await outputChannel.send({ embeds: [embed] });
}

module.exports = {
    sendHitEmbed,
    sendKillEmbed
};
