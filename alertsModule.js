const { EmbedBuilder } = require("discord.js");

// ===== TRACKERS =====
const headshotTracker = new Map();
const brainTracker = new Map();
const recentHits = new Map();

// ===== WEAPON FILTER =====
const MELEE_KEYWORDS = [
    "TriDagger", "knife", "blade", "hatchet", "axe", "sledge",
    "hammer", "mace", "bat", "crowbar", "shovel",
    "pickaxe", "pipe", "wrench", "sword", "machete", "melee"
];

const SHOTGUN_KEYWORDS = [
    "shotgun",
    "bk-43", "bk43",
    "bk-133", "bk133",
    "mp133", "mp-133",
    "vaiga", "saiga",
    "repeater shotgun",
    "double barrel", "R12",
    "Serbu Super Shorty", 
    "M870", "SPAS-12",
    
];

function normalizeWeapon(name) {
    return (name || "").toLowerCase();
}

function isMelee(weapon) {
    const w = normalizeWeapon(weapon);
    return MELEE_KEYWORDS.some(k => w.includes(k));
}

function isShotgun(weapon) {
    const w = normalizeWeapon(weapon);
    return SHOTGUN_KEYWORDS.some(k => w.includes(k));
}

// ===== SAFE NAME =====
function safeName(name) {
    return (name || "unknown").toLowerCase();
}

// ===== store recent hits =====
function storeRecentHit(hit) {
    const now = Date.now();
    const key = safeName(hit.killerName);

    if (!recentHits.has(key)) {
        recentHits.set(key, []);
    }

    const hits = recentHits.get(key);

    hits.push({
        victim: hit.victimName || "unknown",
        link: hit.victimLink,
        weapon: hit.weapon || "-",
        zone: hit.zone || "-",
        distance: hit.distance || "-",
        time: now
    });

    const recent = hits.filter(h => now - h.time <= 10000);
    recentHits.set(key, recent);

    return recent;
}

// ===== HEAD tracking =====
function trackHeadshots(killerName) {
    const now = Date.now();
    const key = safeName(killerName);

    if (!headshotTracker.has(key)) {
        headshotTracker.set(key, []);
    }

    const hits = headshotTracker.get(key);
    hits.push(now);

    const recent = hits.filter(t => now - t <= 30 * 60 * 1000);
    headshotTracker.set(key, recent);

    return {
        count5s: recent.filter(t => now - t <= 5000).length,
        count10s: recent.filter(t => now - t <= 10000).length,
        count30min: recent.length
    };
}

// ===== BRAIN tracking =====
function trackBrain(killerName) {
    const now = Date.now();
    const key = safeName(killerName);

    if (!brainTracker.has(key)) {
        brainTracker.set(key, []);
    }

    const hits = brainTracker.get(key);
    hits.push(now);

    const recent = hits.filter(t => now - t <= 10 * 60 * 1000);
    brainTracker.set(key, recent);

    return recent.length;
}

// ===== helpers =====
function formatPlayer(name, link) {
    if (!name) return "-";
    return link ? `[${name}](${link})` : name;
}

function formatCoords(coords, z) {
    return coords ? `${coords.x}, ${z}, ${coords.y}` : "-";
}

// ===== MAIN =====
async function handleAlerts(hit, alertChannel, coordsKiller, coordsVictim, zKiller, time) {
    try {
        if (!hit || !hit.killerName) return;

        const distance = parseFloat(hit.distance) || 0;

        // ===== FILTER =====
        if (isMelee(hit.weapon)) return;
        if (isShotgun(hit.weapon) && distance < 30) return;
        if (distance < 5) return;

        const victims = storeRecentHit(hit);

        // ===== HEAD ALERT =====
        if (hit.zone === "head") {
            const stats = trackHeadshots(hit.killerName);

            let triggered = false;
            let message = "";

            if (stats.count5s === 3) {
                triggered = true;
                message = `Has hit ${stats.count5s} headshots within 5 seconds`;
            }

            if (stats.count10s === 5) {
                triggered = true;
                message = `Has hit ${stats.count10s} headshots within 10 seconds`;
            }

            if (stats.count30min === 10) {
                triggered = true;
                message = `Has hit ${stats.count30min} headshots within 30 minutes`;
            }

            if (triggered) {
                const shotLink =
                    coordsKiller && coordsVictim
                        ? `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(hit.weapon || "-")}&dist=${hit.distance || "-"}&dmg=${hit.damage || "-"}&hit=${hit.zone || "-"}`
                        : null;

                const victimList = victims.map(v =>
                    v.link
                        ? `[${v.victim}](${v.link}), ${v.weapon}, ${v.zone}, ${v.distance}m`
                        : `${v.victim}, ${v.weapon}, ${v.zone}, ${v.distance}m`
                ).join("\n");

                const embed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle("Grevbot Alert!")
                    .setDescription("⚠️ Suspicious Activity detected !!! ⚠️")
                    .addFields(
                        { name: "Player", value: formatPlayer(hit.killerName, hit.killerLink) },
                        { name: "Activity", value: message },
                        { name: "Victims and weapons", value: victimList || "-" },
                        { name: "Killer coordinates", value: formatCoords(coordsKiller, zKiller) },
                        { name: "Map", value: shotLink ? `[View in map](${shotLink})` : "-" },
                        { name: "Date and time", value: time || "-" }
                    );

                await alertChannel.send({ embeds: [embed] });
            }
        }

        // ===== BRAIN ALERT =====
        if (hit.zone === "brain") {
            const count = trackBrain(hit.killerName);

            if (count === 3) {
                const shotLink =
                    coordsKiller && coordsVictim
                        ? `https://grevgrisk.github.io/dayzmap?killer=${coordsKiller.x},${coordsKiller.y}&victim=${coordsVictim.x},${coordsVictim.y}&weapon=${encodeURIComponent(hit.weapon || "-")}&dist=${hit.distance || "-"}&dmg=${hit.damage || "-"}&hit=${hit.zone || "-"}`
                        : null;

                const victimList = victims.map(v =>
                    v.link
                        ? `[${v.victim}](${v.link}), ${v.weapon}, ${v.zone}, ${v.distance}m`
                        : `${v.victim}, ${v.weapon}, ${v.zone}, ${v.distance}m`
                ).join("\n");

                const embed = new EmbedBuilder()
                    .setColor(0x9900ff)
                    .setTitle("🧠 Grevbot Alert!")
                    .setDescription("⚠️ Suspicious Activity detected !!! ⚠️")
                    .addFields(
                        { name: "Player", value: formatPlayer(hit.killerName, hit.killerLink) },
                        { name: "Activity", value: `Has hit ${count} brain hits within 10 minutes` },
                        { name: "Victims and weapons", value: victimList || "-" },
                        { name: "Killer coordinates", value: formatCoords(coordsKiller, zKiller) },
                        { name: "Map", value: shotLink ? `[View in map](${shotLink})` : "-" },
                        { name: "Date and time", value: time || "-" }
                    );

                await alertChannel.send({ embeds: [embed] });
            }
        }

    } catch (err) {
        console.error("Alerts module error:", err);
    }
}

module.exports = {
    handleAlerts
};
