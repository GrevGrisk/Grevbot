const { EmbedBuilder } = require("discord.js");

// ===== helpers =====
function formatPlayer(name, link) {
    return link ? `[${name}](${link})` : name;
}

function formatCoords(coords, z) {
    return coords ? `${coords.x}, ${z}, ${coords.y}` : "-";
}

// ===== HIT EMBED =====
async function sendHitEmbed({
    outputChannel,
    hit,
    coordsKiller,
    coordsVictim,
    zKiller,
    zVictim,
    time
}) {
    try {
        const shotLink =
            coordsKiller && coordsVictim
                ? `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(hit.weapon)}&dist=${hit.distance}&dmg=${hit.damage}&hit=${hit.zone}`
                : null;

        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .addFields(
                { name: "Killer", value: formatPlayer(hit.killerName, hit.killerLink), inline: true },
                { name: "Victim", value: formatPlayer(hit.victimName, hit.victimLink), inline: true },

                { name: "Weapon", value: hit.weapon, inline: false },

                { name: "Hitzone", value: hit.zone, inline: true },
                { name: "Damage", value: hit.damage.toString(), inline: true },

                { name: "Distance", value: `${hit.distance} m`, inline: true },

                { name: "Killer Coordinates", value: formatCoords(coordsKiller, zKiller), inline: true },
                { name: "Victim Coordinates", value: formatCoords(coordsVictim, zVictim), inline: true },

                { name: "Map", value: shotLink ? `[View in map](${shotLink})` : "-", inline: false },
                { name: "Time", value: `🕒 ${time}`, inline: false }
            );

        await outputChannel.send({ embeds: [embed] });

    } catch (err) {
        console.error("Hit embed error:", err);
    }
}

// ===== KILL EMBED =====
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
    try {
        const shotLink =
            coordsKiller && coordsVictim
                ? `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(kill.weapon)}&dist=${kill.distance}`
                : null;

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .addFields(
                { name: "Killer", value: formatPlayer(kill.killerName, kill.killerLink), inline: true },
                { name: "Victim", value: formatPlayer(kill.victimName, kill.victimLink), inline: true },

                { name: "Weapon", value: kill.weapon, inline: false },

                { name: "Distance", value: `${kill.distance} m`, inline: true },

                { name: "Last Hit Zone", value: last.zone || "-", inline: true },
                { name: "Last Damage", value: last.damage ? last.damage.toString() : "-", inline: true },

                { name: "Killer Coordinates", value: formatCoords(coordsKiller, zKiller), inline: true },
                { name: "Victim Coordinates", value: formatCoords(coordsVictim, zVictim), inline: true },

                { name: "Map", value: shotLink ? `[View in map](${shotLink})` : "-", inline: false },
                { name: "Time", value: `🕒 ${time}`, inline: false }
            );

        await outputChannel.send({ embeds: [embed] });

    } catch (err) {
        console.error("Kill embed error:", err);
    }
}

module.exports = {
    sendHitEmbed,
    sendKillEmbed
};
