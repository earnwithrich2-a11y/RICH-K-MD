const { jidNormalizedUser } = require("gifted-baileys");
const {
    getGroupRole, messageText, hasWebLink, botIdentities, senderIdentities,
} = require("./groupLinkLock");

const LINK_WARNING = "⚠️ Links are strictly not allowed in this group! Your message has been removed.\n\n" +
    "📢 Join our official WhatsApp Channel: https://whatsapp.com/channel/0029VbE9wUJ0Vyc8uRaMNM21\n\n" +
    "⚡ Powered by RICH-K-MD: https://boosting.richkaurex.site";
const recentDeletes = new WeakMap();

function isBotOwner(socket, message, metadata, settings, extra = []) {
    const owner = String(settings.OWNER_NUMBER || "").split("@")[0].replace(/\D/g, "");
    if (!owner) return false;
    const normalize = jid => {
        if (typeof jid !== "string" || !jid) return "";
        return jidNormalizedUser(/^\d+$/.test(jid) ? `${jid}@s.whatsapp.net` : jid);
    };
    const actors = new Set(senderIdentities(socket, message, extra).map(normalize).filter(Boolean));
    for (const member of metadata?.participants || []) {
        const aliases = [member.id, member.lid, member.pn, member.jid, member.phoneNumber]
            .map(normalize).filter(Boolean);
        if (aliases.some(jid => actors.has(jid))) aliases.forEach(jid => actors.add(jid));
    }
    const { getLidMapping } = require("./connection/groupCache");
    for (const jid of [...actors]) {
        if (jid.endsWith("@lid")) {
            const pn = getLidMapping(jid);
            if (pn) actors.add(normalize(pn));
        }
    }
    return actors.has(`${owner}@s.whatsapp.net`);
}

async function enforceSmartAntiLink(socket, message, getMetadata, getSettings) {
    const group = message?.key?.remoteJid;
    if (!group?.endsWith("@g.us") || !message.key.id || !hasWebLink(messageText(message.message))) return false;
    try {
        const [metadata, settings] = await Promise.all([
            getMetadata(socket, group, { forceRefresh: true }),
            getSettings(),
        ]);
        if (!metadata?.participants) return false;
        const actors = senderIdentities(socket, message);
        if (!actors.some(jid => typeof jid === "string" && /@(lid|s\.whatsapp\.net|c\.us)$/.test(jid))) return false;
        const role = getGroupRole(metadata, actors);
        if (role.isAdmin || role.isOwner || isBotOwner(socket, message, metadata, settings)) return false;
        const bot = getGroupRole(metadata, botIdentities(socket));
        if (!bot.isAdmin && !bot.isOwner) return false;

        let deleted = recentDeletes.get(socket);
        if (!deleted) { deleted = new Map(); recentDeletes.set(socket, deleted); }
        const now = Date.now();
        for (const [key, entry] of deleted) if (entry.expires <= now) deleted.delete(key);
        const key = `${group}\0${message.key.id}`;
        if (deleted.has(key)) return deleted.get(key).promise;
        // Reserve before awaiting the delete, preventing duplicate DMs from replayed events.
        const entry = { expires: now + 60000 };
        const action = async () => {
            try {
                await socket.sendMessage(group, { delete: message.key });
            } catch {
                deleted.delete(key);
                return false; // Don't claim removal when WhatsApp rejected it.
            }
            const target = actors.find(jid => typeof jid === "string" && /@(s\.whatsapp\.net|c\.us)$/.test(jid)) ||
                actors.find(jid => typeof jid === "string" && jid.endsWith("@lid"));
            if (target) {
                // A blocked/slow DM must not delay deletion of the next offending message.
                try { void socket.sendMessage(jidNormalizedUser(target), { text: LINK_WARNING }).catch(() => {}); }
                catch { /* Deletion succeeded; DM permission failures are non-fatal. */ }
            }
            return true;
        };
        deleted.set(key, entry);
        entry.promise = action();
        if (deleted.size > 5000) deleted.delete(deleted.keys().next().value);
        return entry.promise;
    } catch {
        return false; // Metadata/network/permission failures must not crash the event handler.
    }
}

async function configureAntiLink(from, socket, context, dependencies = {}) {
    const { q, reply, isGroup, mek, sender, messageAuthor } = context;
    if (!isGroup) return reply("❌ This command only works in groups!");
    const input = (q || "").trim().toLowerCase();
    const modes = { on: "delete", true: "delete", delete: "delete", off: "false", false: "false", warn: "warn", kick: "kick" };
    if (!Object.hasOwn(modes, input)) return reply("Usage: .antilink on or .antilink off\nLegacy modes: .setantilink warn/kick");
    const getMetadata = dependencies.getMetadata || require("./connection/groupCache").getGroupMetadata;
    const getSettings = dependencies.getSettings || require("./database/settings").getAllSettings;
    const save = dependencies.save || require("./database/groupSettings").setGroupSetting;
    try {
        const [metadata, settings] = await Promise.all([
            getMetadata(socket, from, { forceRefresh: true }), getSettings(),
        ]);
        if (!metadata?.participants) return reply("❌ Could not verify group permissions. Try again.");
        const role = getGroupRole(metadata, senderIdentities(socket, mek, [sender, messageAuthor]));
        if (!role.isAdmin && !role.isOwner && !isBotOwner(socket, mek, metadata, settings, [sender, messageAuthor])) {
            return reply("❌ Only group admins and the bot owner can change anti-link.");
        }
        await save(from, "ANTILINK", modes[input]);
        if (modes[input] === "false") {
            return reply("✅ Anti-link OFF for this group. The separate .lockurl setting is unchanged.");
        }
        const bot = getGroupRole(metadata, botIdentities(socket));
        const note = !bot.isAdmin && !bot.isOwner ? "\nMake the bot a group admin so it can remove links." : "";
        return reply(modes[input] === "delete"
            ? `✅ Anti-link ON for this group. Links from non-admins will be removed and the sender warned in DM. The bot owner is exempt.${note}`
            : `✅ Anti-link legacy ${input.toUpperCase()} mode enabled for this group.${note}`);
    } catch {
        return reply("❌ Could not save this group's anti-link setting. Try again.");
    }
}

module.exports = { LINK_WARNING, isBotOwner, enforceSmartAntiLink, configureAntiLink };
