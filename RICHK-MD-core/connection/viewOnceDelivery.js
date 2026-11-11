const { recoverViewOnce } = require("./viewOnceDownload");
const { connectedOwnerJid, isConnectedOwner } = require("./ownerIdentity");
const { unwrap } = require("./recoveryArchive");
const { installAutomatedMessageGuard } = require("./automatedMessageGuard");
const { extractViewOnceMedia } = require("./viewOnceMedia");
const { mediaContent } = require("./automationMedia");

const DOWNLOAD_FAILED_NOTICE =
    "⚠️ WhatsApp couldn't download this View-Once media. It may have expired or the media server rejected the request.";
const NO_VIEW_ONCE_QUOTE = "⚠️ Please reply to a View-Once photo or video.";
const EXPIRED_MEDIA_ERROR = "❌ Could not download this media. It has expired on WhatsApp servers.";
const DOWNLOAD_ERROR = "❌ Could not download this media. Please try again.";
const DELIVERY_ERROR = "❌ Could not send the recovered media. Please try again.";

function isExpiredMediaError(error) {
    const source = error?.cause || error;
    const status = Number(source?.statusCode ?? source?.status ?? source?.output?.statusCode ??
        source?.data?.statusCode ?? source?.response?.status ?? error?.httpStatus);
    const detail = [source?.message, source?.data?.message, source?.output?.payload?.message]
        .filter(Boolean).join(" ").toLowerCase();
    return status === 404 || status === 410 ||
        /\b404\b|expired|not found|no longer available/.test(detail);
}

async function revealQuotedViewOnce(socket, context, {
    download = mediaContent,
    recover = recoverViewOnce,
} = {}) {
    const message = context.mek || context.ms || context.m || {};
    const from = context.from || message.key?.remoteJid || "";
    const reply = typeof context.reply === "function"
        ? context.reply
        : (text) => socket.sendMessage(from, { text }, { quoted: message });
    const react = async (emoji) => {
        try {
            if (typeof context.react === "function") await context.react(emoji);
            else if (message.key?.id && from) {
                await socket.sendMessage(from, { react: { key: message.key, text: emoji } });
            }
        } catch { /* Reactions are best-effort; they must not block media recovery. */ }
    };

    const authorized = context.isSuperUser || message.key?.fromMe ||
        isConnectedOwner(socket, context.sender);
    if (!authorized) {
        await reply("⛔ Only the bot owner can use this command.");
        return false;
    }

    await react("⏳");

    const quoted = context.quoted ?? context.quotedMsg ?? context.quotedMessage;
    const quotedMessage = quoted?.message && typeof quoted.message === "object"
        ? quoted.message
        : quoted;
    const found = extractViewOnceMedia(quotedMessage);
    if (!found) {
        await reply(NO_VIEW_ONCE_QUOTE);
        return false;
    }

    let media;
    try {
        // The recovery routine tries this quoted payload first, then can restore
        // keys or bytes captured when the original incoming message arrived.
        const recoveryContext = { ...context, quoted: quotedMessage, quotedMsg: quotedMessage };
        media = await recover(socket, recoveryContext, { save: download });
        if (!media) throw new Error("Baileys returned no media");
    } catch (error) {
        await reply(isExpiredMediaError(error) ? EXPIRED_MEDIA_ERROR : DOWNLOAD_ERROR);
        return false;
    }

    const isGroup = context.isGroup ?? from.endsWith("@g.us");
    const destination = isGroup ? connectedOwnerJid(socket) : from;
    if (!destination) {
        await reply("❌ Could not find the bot owner's private chat.");
        return false;
    }

    try {
        await socket.sendMessage(destination, media);
    } catch {
        await reply(DELIVERY_ERROR);
        return false;
    }

    if (isGroup) await react("✅");
    return true;
}

async function saveViewOnceSilently(socket, context, { recover = recoverViewOnce } = {}) {
    const message = context.mek || context.m || {};
    if (!context.isSuperUser && !message.key?.fromMe && !isConnectedOwner(socket, context.sender)) return false;
    const owner = connectedOwnerJid(socket);
    if (!owner) return false; // Never fall back to the current chat or requester.
    let media;
    try { media = await recover(socket, context); }
    catch (error) {
        if (error?.code === "VIEW_ONCE_DOWNLOAD_FAILED") {
            try {
                await socket.sendMessage(owner, { text: DOWNLOAD_FAILED_NOTICE });
            } catch { /* The private status is best-effort; never fall back to the source chat. */ }
        }
        console.warn("[ViewOnce] Private save unavailable; source chat left silent.");
        return false;
    }
    if (!media) return false;
    try {
        await socket.sendMessage(owner, media);
        return true;
    } catch {
        console.warn("[ViewOnce] Private delivery failed; source chat left silent.");
        return false;
    }
}

function installViewOnceReactions(socket, { save = saveViewOnceSilently, now = Date.now } = {}) {
    const isAutomated = installAutomatedMessageGuard(socket);
    const seen = new Map();
    let closed = false;
    async function handle(message) {
        try {
            if (closed || isAutomated(message)) return;
            const reaction = unwrap(message.message)?.reactionMessage;
            if (!/^👍(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?$/u.test(reaction?.text || "") ||
                !reaction.key?.id || !message.key?.id) return;
            const sender = message.key.participantPn || message.key.senderPn ||
                message.key.participantAlt || message.key.participant || message.key.remoteJid;
            // The reaction target's fromMe flag identifies its author, not the reactor.
            if (!message.key.fromMe && !isConnectedOwner(socket, sender)) return;
            const time = now();
            const stamp = reaction.senderTimestampMs;
            const eventTime = Number(stamp?.toNumber?.() ?? stamp);
            if (stamp != null && (!Number.isFinite(eventTime) || eventTime < time - 60000 || eventTime > time + 30000)) return;
            for (const [id, expires] of seen) if (expires <= time) seen.delete(id);
            const token = `${message.key.id}:${reaction.key.id}:${reaction.senderTimestampMs || ""}`;
            if (seen.has(token)) return;
            seen.set(token, time + 15 * 60 * 1000);
            while (seen.size > 512) seen.delete(seen.keys().next().value);
            await save(socket, {
                mek: message, sender, isSuperUser: true,
                quotedKey: reaction.key,
                quotedMessageContext: { stanzaId: reaction.key.id },
            });
        } catch { console.warn("[ViewOnce] Reaction save unavailable; source chat left silent."); }
    }
    const upsert = ({ messages = [], type }) => {
        if (type && type !== "notify" && type !== "append") return;
        for (const message of messages) {
            // Append can contain old history; without a timestamp it is not a live action.
            if (type === "append" && !unwrap(message.message)?.reactionMessage?.senderTimestampMs) continue;
            void handle(message);
        }
    };
    const reactions = (updates = []) => {
        for (const entry of updates) void handle({
            key: entry.reaction?.key,
            message: { reactionMessage: { ...entry.reaction, key: entry.key } },
        });
    };
    const connection = ({ connection }) => { if (connection === "close") destroy(); };
    function destroy() {
        closed = true;
        seen.clear();
        socket.ev.off("messages.upsert", upsert);
        socket.ev.off("messages.reaction", reactions);
        socket.ev.off("connection.update", connection);
    }
    socket.ev.on("messages.upsert", upsert);
    socket.ev.on("messages.reaction", reactions);
    socket.ev.on("connection.update", connection);
    return { destroy, handle };
}

module.exports = { revealQuotedViewOnce, saveViewOnceSilently, installViewOnceReactions };
