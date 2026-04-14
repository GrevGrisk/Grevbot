const { EmbedBuilder } = require("discord.js");

function formatPlayer(name, link) {
    if (!name) return "-";
    return link ? `[${name}](${link})` : name;
}

// X, Z, Y (som spillet ditt bruker)
function formatCoords(coords, z) {
    return coords ? `${coords.x}, ${z}, ${coords.y}` : "-";
}

// ===== HIT =====
async function sendHitEmbed({
    outputChannel,
    hit,
    coordsKiller,
    coordsVictim,
    zKiller,
    zVictim,
    time
}) {
    const shotLink =
        coordsKiller && coordsVictim
            ? `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(hit.weapon)}&dist=${hit.distance}&dmg=${hit.damage}&hit=${hit.zone}`
            : null;

    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("Grevbot Line-of-sight analysis")
        .addFields(
            { name: "Killer", value: formatPlayer(hit.killerName, hit.killerLink), inline: true },
            { name: "Victim", value: formatPlayer(hit.victimName, hit.victimLink), inline: true },

            { name: "Weapon", value: hit.weapon },

            { name: "Hitzone", value: hit.zone || "-", inline: true },
            { name: "Damage", value: hit.damage ? hit.damage.toString() : "-", inline: true },
            { name: "Distance", value: `${hit.distance} m`, inline: true },

            { name: "Killer Coordinates", value: formatCoords(coordsKiller, zKiller), inline: true },
            { name: "Victim Coordinates", value: formatCoords(coordsVictim, zVictim), inline: true },

            { name: "Map", value: shotLink ? `[View in map](${shotLink})` : "-" },
            { name: "Time", value: `🕒 ${time}` }
        );

    await outputChannel.send({ embeds: [embed] });
}

// ===== KILL =====
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
    const hitzone = last?.zone || "-";
    const damage = last?.damage || "-";

    const shotLink =
        coordsKiller && coordsVictim
            ? `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(kill.weapon)}&dist=${kill.distance}&dmg=${damage}&hit=${hitzone}`
            : null;

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("Grevbot Line-of-sight analysis")
        .addFields(
            { name: "Killer", value: formatPlayer(kill.killerName, kill.killerLink), inline: true },
            { name: "Victim", value: formatPlayer(kill.victimName, kill.victimLink), inline: true },

            { name: "Weapon", value: kill.weapon },

            // 🔥 FIX: henter fra lastHit
            { name: "Hitzone", value: hitzone, inline: true },
            { name: "Damage", value: damage.toString(), inline: true },
            { name: "Distance", value: `${kill.distance} m`, inline: true },

            { name: "Killer Coordinates", value: formatCoords(coordsKiller, zKiller), inline: true },
            { name: "Victim Coordinates", value: formatCoords(coordsVictim, zVictim), inline: true },

            { name: "Map", value: shotLink ? `[View in map](${shotLink})` : "-" },
            { name: "Time", value: `🕒 ${time}` }
        );

    await outputChannel.send({ embeds: [embed] });
}

module.exports = {
    sendHitEmbed,
    sendKillEmbed
};
