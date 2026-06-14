const { EmbedBuilder } = require("discord.js");
const pool = require("./db");

function cfProfileUrl(cftoolsId) {
    return cftoolsId ? `https://app.cftools.cloud/profile/${cftoolsId}` : null;
}

function playerLink(name, cftoolsId) {
    const safeName = name || "Unknown";
    const url = cfProfileUrl(cftoolsId);
    return url ? `[${safeName}](${url})` : safeName;
}

function normalizeNationality(input) {
    if (!input) return "";

    const lower = input.trim().toLowerCase();

    const aliases = {
        norge: "norway",
        norway: "norway",
        no: "no",
        sverige: "sweden",
        sweden: "sweden",
        se: "se",
        danmark: "denmark",
        denmark: "denmark",
        dk: "dk",
        tyskland: "germany",
        germany: "germany",
        de: "de",
        frankrike: "france",
        france: "france",
        fr: "fr",
        finland: "finland",
        fi: "fi",
        polen: "poland",
        poland: "poland",
        pl: "pl",
        nederland: "netherlands",
        netherlands: "netherlands",
        nl: "nl",
        uk: "gb",
        gb: "gb",
        england: "gb",
        "united kingdom": "gb",
        usa: "us",
        us: "us",
        "united states": "us"
    };

    return aliases[lower] || lower;
}

function formatDate(value) {
    if (!value) return "Unknown";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleString("no-NO", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function clean(value) {
    if (value === null || value === undefined || value === "") return "Unknown";
    return String(value);
}

async function searchPlayersByLocation(nationality, hours) {
    const normalized = normalizeNationality(nationality);

    const result = await pool.query(`
        SELECT
            ap.id AS player_id,
            ap.steam64,
            ap.cftools_id,
            ap.last_name,
            ail.ip_masked,
            ail.ip_subnet,
            ail.provider,
            ail.country_code,
            ail.country_name,
            ail.last_seen,
            ail.seen_count
        FROM alt_ip_links ail
        JOIN alt_players ap ON ap.id = ail.player_id
        WHERE (
            LOWER(ail.country_name) = LOWER($1)
            OR LOWER(ail.country_code) = LOWER($1)
        )
          AND ail.last_seen >= NOW() - ($2 * INTERVAL '1 hour')
        ORDER BY ail.last_seen DESC
    `, [normalized, hours]);

    return {
        rows: result.rows.slice(0, 5),
        totalRows: result.rows.length
    };
}

function buildLocationEmbed(nationality, hours, rows, totalRows) {
    const embed = new EmbedBuilder()
        .setTitle("🌍 Location search")
        .setColor(0x2f80ed)
        .setDescription(
            `**Nationality:** ${nationality}\n` +
            `**Time window:** Last ${hours} hour(s)\n` +
            `**Results:** ${totalRows} player(s)\n` +
            `**Showing:** ${rows.length} player(s)`
        )
        .setFooter({ text: "GrevBot • Location search" })
        .setTimestamp();

    if (rows.length === 0) {
        embed.addFields({
            name: "No results",
            value: "No stored players matched that nationality in the selected time window."
        });
        return embed;
    }

    for (const row of rows) {
        const ipText = row.ip_masked || row.ip_subnet || "Unknown";
        const countryText = row.country_name || row.country_code || "Unknown";

        embed.addFields({
            name: `👤 ${row.last_name || "Unknown"}`,
            value:
                `**Player:** ${playerLink(row.last_name, row.cftools_id)}\n` +
                `**Steam64:** \`${clean(row.steam64)}\`\n` +
                `**IP:** \`${clean(ipText)}\`\n` +
                `**Provider:** ${clean(row.provider)}\n` +
                `**Country:** ${clean(countryText)}\n` +
                `**Login:** ${formatDate(row.last_seen)}\n` +
                `**Seen:** ${clean(row.seen_count)} time(s)`,
            inline: false
        });
    }

    if (totalRows > rows.length) {
        embed.addFields({
            name: "More results",
            value: `Showing first ${rows.length} of ${totalRows}. Use a shorter time window to narrow the search.`
        });
    }

    return embed;
}

async function handleLocation(interaction) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply();
        }

        const nationality = interaction.options.getString("nationality");
        const hours = interaction.options.getInteger("hours");

        const { rows, totalRows } = await searchPlayersByLocation(nationality, hours);
        const embed = buildLocationEmbed(nationality, hours, rows, totalRows);

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.error("Location search error:", err);

        try {
            const message = `Location search failed. Error: ${err.message || err}`;

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(message);
            } else {
                await interaction.reply({
                    content: message,
                    ephemeral: true
                });
            }
        } catch (replyErr) {
            console.error("Failed to send location error reply:", replyErr);
        }
    }
}

module.exports = {
    handleLocation
};
