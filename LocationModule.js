const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const pool = require("./db");

const PAGE_SIZE = 5;

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
        norge: "no",
        norway: "no",
        no: "no",
        sverige: "se",
        sweden: "se",
        se: "se",
        danmark: "dk",
        denmark: "dk",
        dk: "dk",
        tyskland: "de",
        germany: "de",
        de: "de",
        frankrike: "fr",
        france: "fr",
        fr: "fr",
        finland: "fi",
        fi: "fi",
        polen: "pl",
        poland: "pl",
        pl: "pl",
        nederland: "nl",
        netherlands: "nl",
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

function countryFlag(code) {
    if (!code || code.length !== 2) return "🌍";
    return code
        .toUpperCase()
        .replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt()));
}

function formatDate(value) {
    if (!value) return "Unknown";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleString("no-NO", {
        timeZone: "Europe/Oslo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });
}

function clean(value) {
    if (value === null || value === undefined || value === "") return "Unknown";
    return String(value);
}

function normalizeProvider(input) {
    if (!input) return null;

    const value = input.trim();
    return value.length > 0 ? value : null;
}

async function searchPlayersByLocation(nationality, hours, provider) {
    const normalized = normalizeNationality(nationality);
    const countryCode = normalized.toUpperCase();
    const providerFilter = normalizeProvider(provider);

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
        WHERE ail.country_code = $1
          AND ail.last_seen >= NOW() - ($2 * INTERVAL '1 hour')
          AND (
              $3::text IS NULL
              OR LOWER(ail.provider) LIKE LOWER('%' || $3 || '%')
          )
        ORDER BY ail.last_seen DESC
    `, [countryCode, hours, providerFilter]);

    return result.rows;
}

function buildLocationEmbed(nationality, hours, provider, rows, page) {
    const totalRows = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
    const start = page * PAGE_SIZE;
    const visibleRows = rows.slice(start, start + PAGE_SIZE);

    const firstCountry = visibleRows[0] || rows[0] || {};
    const flag = countryFlag(firstCountry.country_code);

    const providerText = normalizeProvider(provider) ? `\n🏢 **Provider filter:** ${clean(provider)}` : "";

    const embed = new EmbedBuilder()
        .setTitle("🌍 GrevBot location query")
        .setColor(0x2f80ed)
        .setDescription(
            `🧭 **Nationality:** ${flag} ${nationality}\n` +
            `⏱️ **Time window:** Last ${hours} hour(s)\n` +
            `👥 **Results:** ${totalRows} player(s)\n` +
            `📄 **Page:** ${page + 1}/${totalPages}` +
            providerText
        )
        .setFooter({ text: "GrevBot • Location query" })
        .setTimestamp();

    if (totalRows === 0) {
        embed.addFields({
            name: "🔎 No results",
            value: "No stored players matched that nationality/provider in the selected time window."
        });
        return embed;
    }

    for (const row of visibleRows) {
        const ipText = row.ip_masked || row.ip_subnet || "Unknown";
        const countryText = `${countryFlag(row.country_code)} ${row.country_name || row.country_code || "Unknown"}`;

        embed.addFields({
            name: `👤 ${playerLink(row.last_name, row.cftools_id)}`,
            value:
                `🎮 **Steam64:** \`${clean(row.steam64)}\`\n` +
                `🌐 **IP:** \`${clean(ipText)}\`\n` +
                `🏢 **Provider:** ${clean(row.provider)}\n` +
                `📍 **Country:** ${clean(countryText)}\n` +
                `🕒 **Login:** ${formatDate(row.last_seen)}`,
            inline: false
        });
    }

    if (totalRows > PAGE_SIZE) {
        embed.addFields({
            name: "📌 Navigation",
            value: `Use the buttons below to browse all ${totalRows} result(s).`
        });
    }

    return embed;
}

function buildButtons(page, totalRows) {
    const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("location_prev")
            .setLabel("Previous")
            .setEmoji("⬅️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 0),

        new ButtonBuilder()
            .setCustomId("location_page")
            .setLabel(`Page ${page + 1}/${totalPages}`)
            .setEmoji("📄")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),

        new ButtonBuilder()
            .setCustomId("location_next")
            .setLabel("Next")
            .setEmoji("➡️")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page >= totalPages - 1)
    );
}

async function handleLocation(interaction) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply();
        }

        const nationality = interaction.options.getString("nationality");
        const hours = interaction.options.getInteger("hours");
        const provider = interaction.options.getString("provider");

        const rows = await searchPlayersByLocation(nationality, hours, provider);
        let page = 0;

        const embed = buildLocationEmbed(nationality, hours, provider, rows, page);
        const components = rows.length > PAGE_SIZE ? [buildButtons(page, rows.length)] : [];

        const message = await interaction.editReply({
            embeds: [embed],
            components
        });

        if (rows.length <= PAGE_SIZE) return;

        const collector = message.createMessageComponentCollector({
            time: 10 * 60 * 1000
        });

        collector.on("collect", async buttonInteraction => {
            if (buttonInteraction.user.id !== interaction.user.id) {
                await buttonInteraction.reply({
                    content: "Only the user who ran the command can use these buttons.",
                    ephemeral: true
                });
                return;
            }

            const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

            if (buttonInteraction.customId === "location_prev") {
                page = Math.max(0, page - 1);
            }

            if (buttonInteraction.customId === "location_next") {
                page = Math.min(totalPages - 1, page + 1);
            }

            await buttonInteraction.update({
                embeds: [buildLocationEmbed(nationality, hours, provider, rows, page)],
                components: [buildButtons(page, rows.length)]
            });
        });

        collector.on("end", async () => {
            try {
                await interaction.editReply({
                    components: []
                });
            } catch (err) {
                console.error("Failed to remove location buttons:", err);
            }
        });

    } catch (err) {
        console.error("Location search error:", err);

        const message = `Location search failed. Error: ${err.message || err}`;

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                content: message,
                embeds: [],
                components: []
            });
        } else {
            await interaction.reply({
                content: message,
                ephemeral: true
            });
        }
    }
}

module.exports = {
    handleLocation
};
