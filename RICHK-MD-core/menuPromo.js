const Database = require("better-sqlite3");
const { jidNormalizedUser } = require("gifted-baileys");
const { verifiedPrivateAliases } = require("./messageRetry");

const COOLDOWN_MS = 12 * 60 * 60 * 1000;
const PROMO_MESSAGE = "⚡ Powered by RICH-K-MD\n\n" +
    "📢 Official Channel for updates & tricks:\n" +
    "https://whatsapp.com/channel/0029VbE9wUJ0Vyc8uRaMNM21\n\n" +
    "🚀 Boost Social Media & Get Virtual Numbers:\n" +
    "https://boosting.richkaurex.site";
function privateJid(jid) {
    if (typeof jid !== "string") return "";
    const normalized = jidNormalizedUser(jid);
    return /@(s\.whatsapp\.net|lid)$/.test(normalized) ? normalized : "";
}

class MenuPromo {
    constructor(filename, now = Date.now) {
        this.db = new Database(filename);
        this.db.pragma("journal_mode = WAL");
        this.db.exec("CREATE TABLE IF NOT EXISTS menu_promo_cooldown (recipient TEXT PRIMARY KEY, last_sent INTEGER NOT NULL)");
        this.now = now;
        this.reserve = this.db.transaction(aliases => {
            const now = this.now();
            const read = this.db.prepare("SELECT last_sent FROM menu_promo_cooldown WHERE recipient = ?");
            const latest = Math.max(...aliases.map(jid => read.get(jid)?.last_sent ?? -Infinity));
            // Learn new aliases even on suppressed requests, retaining the same cooldown.
            const stamp = now - latest < COOLDOWN_MS ? latest : now;
            const write = this.db.prepare("INSERT OR REPLACE INTO menu_promo_cooldown VALUES (?, ?)");
            for (const jid of aliases) write.run(jid, stamp);
            return stamp === now && now - latest >= COOLDOWN_MS;
        });
    }
    async maybeSend(socket, command, message) {
        const key = message?.key;
        // Exact commands only, outgoing bot-account messages, and genuine private peers.
        if (!["menu", "settings"].includes(command) || key?.fromMe !== true || !privateJid(key.remoteJid)) return false;
        const aliases = verifiedPrivateAliases(key);
        const mapping = socket.signalRepository?.lidMapping;
        for (const jid of [...aliases]) {
            try {
                const mapped = jid.endsWith("@lid")
                    ? await mapping?.getPNForLID?.(jid)
                    : await mapping?.getLIDForPN?.(jid);
                const normalized = privateJid(mapped);
                if (normalized) aliases.add(normalized);
            } catch { /* Transport-supplied aliases and local cache still apply. */ }
        }
        const own = [socket.user?.id, socket.user?.lid,
            socket.authState?.creds?.me?.id, socket.authState?.creds?.me?.lid]
            .map(privateJid).filter(Boolean);
        if (!aliases.size || own.some(jid => aliases.has(jid))) return false;
        if (!this.reserve([...aliases])) return false;
        // Reserve durably before sending: restarts/concurrent commands cannot double-send.
        // An ambiguous failed send keeps the reservation to avoid repeated unsolicited DMs.
        try {
            await socket.sendMessage(key.remoteJid, { text: PROMO_MESSAGE });
            return true;
        } catch {
            console.warn("[Menu promo] Delivery unavailable; cooldown retained to prevent duplicate messages.");
            return false;
        }
    }
}

module.exports = { MenuPromo, PROMO_MESSAGE, COOLDOWN_MS };
