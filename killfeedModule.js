const { EmbedBuilder } = require("discord.js");

// 🔥 SAFE FIX (kun lagt til)
const safe = (v) => (v !== undefined && v !== null) ? String(v) : "-";

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
            { name: "Killer", value: hit.killerLink ? `[${safe(hit.killerName)}](${hit.killerLink})` : safe(hit.killerName), inline: true },
            { name: "Victim", value: hit.victimLink ? `[${safe(hit.victimName)}](${hit.victimLink})` : safe(hit.victimName), inline: true },
            { name: "Weapon", value: safe(hit.weapon) },
            { name: "Hitzone", value: safe(hit.zone), inline: true },
            { name: "Damage", value: safe(hit.damage), inline: true },
            { name: "Distance", value: `${safe(hit.distance)} m`, inline: true },
            { name: "Killer Coordinates", value: coordsKiller ? `${safe(coordsKiller.x)}, ${safe(zKiller)}, ${safe(coordsKiller.y)}` : "-" },
            { name: "Victim Coordinates", value: coordsVictim ? `${safe(coordsVictim.x)}, ${safe(zVictim)}, ${safe(coordsVictim.y)}` : "-" },
            { name: "Map", value: mapLink ? `[View in map](${mapLink})` : "-" },
            { name: "Time", value: safe(time) }
        );

    await outputChannel.send({ embeds: [embed] });
}

// ===== KILL (RØD) =====
async function sendKillEmbed({ outputChannel, kill, last, coordsKiller, coordsVictim, zKiller, zVictim, time }) {
    const mapLink =
        coordsKiller && coordsVictim
            ? `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(kill.weapon)}&dist=${kill.distance}&dmg=${safe(last?.damage)}&hit=${safe(last?.zone)}`
            : null;

    const embed = new EmbedBuilder()
        .setColor(0xff0000) // 🔴 KILL = RØD
        .setTitle("Grevbot Line-of-sight analysis")
        .addFields(
            { name: "Killer", value: kill.killerLink ? `[${safe(kill.killerName)}](${kill.killerLink})` : safe(kill.killerName), inline: true },
            { name: "Victim", value: kill.victimLink ? `[${safe(kill.victimName)}](${kill.victimLink})` : safe(kill.victimName), inline: true },
            { name: "Weapon", value: safe(kill.weapon) },
            { name: "Hitzone", value: safe(last?.zone), inline: true },
            { name: "Damage", value: safe(last?.damage), inline: true },
            { name: "Distance", value: `${safe(kill.distance)} m`, inline: true },
            { name: "Killer Coordinates", value: coordsKiller ? `${safe(coordsKiller.x)}, ${safe(zKiller)}, ${safe(coordsKiller.y)}` : "-" },
            { name: "Victim Coordinates", value: coordsVictim ? `${safe(coordsVictim.x)}, ${safe(zVictim)}, ${safe(coordsVictim.y)}` : "-" },
            { name: "Map", value: mapLink ? `[View in map](${mapLink})` : "-" },
            { name: "Time", value: safe(time) }
        );

    await outputChannel.send({ embeds: [embed] });
}

module.exports = {
    sendHitEmbed,
    sendKillEmbed
};
