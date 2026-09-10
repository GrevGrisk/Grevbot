const { EmbedBuilder } = require("discord.js");

const WINDOW_MS = 1000;
const ALERT_COOLDOWN_MS = 1500;

const recentHits = new Map();
const lastAlert = new Map();

const safe = (v) => (v !== undefined && v !== null) ? String(v) : "-";

function getCftoolsId(link) {
    if (!link) return null;

    const cleanLink = String(link).replace(/[<>]/g, "").trim();
    const match = cleanLink.match(/\/profile\/([a-zA-Z0-9]+)/i);

    return match ? match[1] : null;
}

function getPlayerKey(id, name) {
    return id || String(name || "unknown").toLowerCase();
}

function profileUrl(id, fallbackLink) {
    if (id) return `https://app.cftools.cloud/profile/${id}`;
    if (!fallbackLink) return null;

    return String(fallbackLink).replace(/[<>]/g, "").trim();
}

function buildMapLink({ killerCoords, hitA, hitB }) {
    if (!killerCoords || !hitA?.coordsVictim || !hitB?.coordsVictim) {
        return null;
    }

    const params = new URLSearchParams({
        killer: `${killerCoords.x},${killerCoords.y}`,
        victimA: `${hitA.coordsVictim.x},${hitA.coordsVictim.y}`,
        victimB: `${hitB.coordsVictim.x},${hitB.coordsVictim.y}`,
        distA: safe(hitA.distance),
        distB: safe(hitB.distance),
        dmgA: safe(hitA.damage),
        dmgB: safe(hitB.damage),
        hitA: safe(hitA.zone),
        hitB: safe(hitB.zone),
        weaponA: safe(hitA.weapon),
        weaponB: safe(hitB.weapon)
    });

    return `https://grevgrisk.github.io/dayzmap?${params.toString()}`;
}

function hitLine(hitData) {
    const victimUrl = profileUrl(hitData.victimId, hitData.victimLink);

    const victimText = victimUrl
        ? `[${safe(hitData.victimName)}](${victimUrl})`
        : safe(hitData.victimName);

    return (
        `${victimText}\n` +
        `**Weapon:** ${safe(hitData.weapon)}\n` +
        `**Distance:** ${safe(hitData.distance)} m\n` +
        `**Damage:** ${safe(hitData.damage)}\n` +
        `**Hitzone:** ${safe(hitData.zone)}`
    );
}

async function handleHit({
    hit,
    msg,
    alertChannel,
    coordsKiller,
    coordsVictim,
    zKiller,
    zVictim,
    time
}) {
    if (!hit || !msg || !alertChannel) return false;

    const timestamp = msg.createdTimestamp;
    if (!Number.isFinite(timestamp)) return false;

    const attackerId = getCftoolsId(hit.killerLink);
    const victimId = getCftoolsId(hit.victimLink);

    const attackerKey = getPlayerKey(attackerId, hit.killerName);
    const victimKey = getPlayerKey(victimId, hit.victimName);

    const history = recentHits.get(attackerKey) || [];

    const freshHistory = history.filter(
        entry => timestamp - entry.timestamp < WINDOW_MS
    );

    const previousHit = [...freshHistory]
        .reverse()
        .find(entry => entry.victimKey !== victimKey);

    const currentHit = {
        timestamp,
        victimKey,
        victimId,
        victimName: hit.victimName,
        victimLink: hit.victimLink,
        weapon: hit.weapon,
        distance: hit.distance,
        damage: hit.damage,
        zone: hit.zone,
        coordsVictim,
        zVictim
    };

    freshHistory.push(currentHit);
    recentHits.set(attackerKey, freshHistory);

    if (!previousHit) return false;

    const deltaMs = timestamp - previousHit.timestamp;

    if (deltaMs < 0 || deltaMs >= WINDOW_MS) {
        return false;
    }

    const alertKey =
        `${attackerKey}:` +
        `${[previousHit.victimKey, victimKey].sort().join(":")}`;

    const previousAlertTime = lastAlert.get(alertKey) || 0;

    if (timestamp - previousAlertTime < ALERT_COOLDOWN_MS) {
        return false;
    }

    lastAlert.set(alertKey, timestamp);

    const attackerUrl = profileUrl(attackerId, hit.killerLink);

    const attackerText = attackerUrl
        ? `[${safe(hit.killerName)}](${attackerUrl})`
        : safe(hit.killerName);

    const mapLink = buildMapLink({
        killerCoords: coordsKiller,
        hitA: previousHit,
        hitB: currentHit
    });

    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("Grevbot Alert !")
        .setDescription("🚩 **!! HITS ON MULTIPLE PLAYERS SIMULTANEOUSLY DETECTED !!**")
        .addFields(
            {
                name: "Shooter",
                value: attackerText,
                inline: false
            },
            {
                name: "Hit A",
                value: hitLine(previousHit),
                inline: true
            },
            {
                name: "Hit B",
                value: hitLine(currentHit),
                inline: true
            },
            {
                name: "Time between hits",
                value: `${deltaMs} ms`,
                inline: false
            },
            {
                name: "Shooter Coordinates",
                value: coordsKiller
                    ? `${safe(coordsKiller.x)}, ${safe(zKiller)}, ${safe(coordsKiller.y)}`
                    : "-",
                inline: false
            },
            {
                name: "Map",
                value: mapLink ? `[View in map](${mapLink})` : "-",
                inline: false
            },
            {
                name: "Time",
                value: safe(time),
                inline: false
            }
        )
        .setTimestamp(new Date(timestamp));

    await alertChannel.send({ embeds: [embed] });

    return true;
}

module.exports = {
    handleHit
};

