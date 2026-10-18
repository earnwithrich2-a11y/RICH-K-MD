const crypto = require("crypto");
const path = require("path");
const { unwrap } = require("./recoveryArchive");
const { safeStringify } = require("../database/messageStore");

const MEDIA = {
    imageMessage: "image", audioMessage: "audio", stickerMessage: "sticker",
    videoMessage: "video", documentMessage: "document",
};
function textOf(message) {
    if (!message) return "(original not available)";
    return message.conversation ?? message.extendedTextMessage?.text ??
        message.imageMessage?.caption ?? message.videoMessage?.caption ??
        message.documentMessage?.caption ?? `[${Object.keys(message).find(key => MEDIA[key]) || "message"}]`;
}
function enabled(value) { return !["false", "off", "0"].includes(String(value).toLowerCase()); }
function connectedUserJid(socket) {
    const id = socket.user?.id || socket.authState?.creds?.me?.id;
    const number = String(id || "").split(":")[0].split("@")[0].replace(/\D/g, "");
    if (!number) throw new Error("Connected WhatsApp user number is unavailable");
    return `${number}@s.whatsapp.net`;
}

function timestampText(message, fallback) {
    let timestamp = message?.messageTimestamp ?? fallback;
    if (timestamp && typeof timestamp.toNumber === "function") timestamp = timestamp.toNumber();
    else if (timestamp && typeof timestamp === "object" && timestamp.low !== undefined) timestamp = timestamp.low;
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return "Unknown";
    const date = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? "Unknown" : date.toISOString();
}

async function senderDetails(socket, original, eventKey) {
    const key = original?.key || eventKey || {};
    let jid = key.participantPn || key.senderPn || key.participant ||
        key.remoteJidAlt || key.remoteJid || "";
    if (jid.endsWith("@lid")) {
        try {
            jid = await socket.signalRepository?.lidMapping?.getPNForLID(jid) || jid;
        } catch { /* Use the saved LID when a phone mapping is not available. */ }
    }
    const number = jid.endsWith("@s.whatsapp.net")
        ? jid.split("@")[0].split(":")[0].replace(/\D/g, "")
        : "";
    const tag = number ? `@${number}` : "";
    const name = original?.pushName || "";
    return {
        mention: number ? `${number}@s.whatsapp.net` : null,
        display: tag ? `${tag}${name ? ` (${name})` : ""}` : name || jid || "Unknown",
    };
}

function installMessageRecovery(socket, { archive, getSettings, download, revokeType = 1, retryMs = 1000, initiallyOnline = false }) {
    let online = initiallyOnline;
    let stopped = false;
    let lastCleanup = 0;
    const active = new Map();
    const downloading = new Set();
    const mediaQueue = new Set();

    function startDownloads() {
        while (!stopped && downloading.size < 4 && mediaQueue.size) {
            const key = mediaQueue.values().next().value;
            mediaQueue.delete(key);
            const row = archive.db.prepare("SELECT chat, id FROM originals WHERE key = ?").get(key);
            if (!row) continue;
            downloading.add(key);
            archive.cacheMedia(archive.find(row.chat, row.id), download)
                .catch(() => console.warn("[Recovery] Early media download failed; recovery will retry."))
                .finally(() => { downloading.delete(key); startDownloads(); });
        }
    }
    function capture(message) {
        const key = archive.capture(message);
        if (key && Object.keys(MEDIA).some(type => unwrap(message.message)?.[type])) mediaQueue.add(key);
    }
    function queue(kind, key, edited, timestamp) {
        if (!key?.id || !key.remoteJid || key.fromMe || key.remoteJid === "status@broadcast") return;
        const row = archive.find(key.remoteJid, key.id);
        const fingerprint = kind === "edit"
            ? crypto.createHash("sha256").update(`${timestamp || ""}:${safeStringify(edited)}`).digest("hex") : "";
        const originalKey = row?.key || archive.key(key.remoteJid, key.id);
        archive.enqueue({
            key: `${originalKey}\0${kind}\0${fingerprint}`,
            originalKey, chat: key.remoteJid, id: key.id, kind, edited,
            eventKey: key, timestamp, alertSent: false,
        });
    }
    async function deliver(job) {
        const event = job.event;
        const settings = await getSettings();
        const mode = event.kind === "delete" ? settings.ANTIDELETE : settings.ANTI_EDIT;
        if (!enabled(mode)) { archive.complete(job.key); return; }
        const target = String(mode).toLowerCase() === "inchat"
            ? event.chat
            : connectedUserJid(socket);
        const row = archive.find(event.chat, event.id);
        const message = row?.original.message;
        const label = event.kind === "delete" ? "DELETED MESSAGE" : "EDITED MESSAGE";
        const sender = await senderDetails(socket, row?.original, event.eventKey);
        const alert = `*RICH-K-MD • ${label}*\n\n` +
            `Chat: ${event.chat}\nSender: ${sender.display}\n` +
            `Timestamp: ${timestampText(row?.original, event.timestamp)}\n` +
            `Original: ${textOf(message)}` +
            (event.kind === "edit" ? `\nEdited to: ${textOf(event.edited)}` : "") +
            (!row ? "\nThe original was not received or is outside the recovery retention window." : "");
        if (!event.alertSent) {
            // Notify immediately, before slow media download/upload or metadata lookups.
            await socket.sendMessage(target, {
                text: alert,
                ...(sender.mention ? { mentions: [sender.mention] } : {}),
            });
            event.alertSent = true;
            archive.db.prepare("UPDATE deliveries SET data = ? WHERE key = ?")
                .run(safeStringify(event), job.key);
        }
        const mediaType = message && Object.keys(MEDIA).find(type => message[type]);
        if (mediaType) {
            await archive.cacheMedia(row, download);
            const cached = archive.find(event.chat, event.id);
            if (!cached?.media) throw new Error("Original media unavailable");
            const data = message[mediaType];
            const content = {
                [MEDIA[mediaType]]: { url: path.join(archive.dir, cached.media) },
            };
            if (["imageMessage", "videoMessage", "documentMessage"].includes(mediaType)) {
                content.caption = `*Original ${event.kind === "edit" ? "before edit" : "deleted message"}*\n${textOf(message)}`;
            }
            if (data.mimetype) content.mimetype = data.mimetype;
            if (mediaType === "audioMessage") content.ptt = Boolean(data.ptt);
            if (mediaType === "documentMessage") content.fileName = data.fileName || "document";
            await socket.sendMessage(target, content);
        }
        archive.complete(job.key);
    }
    async function flush() {
        if (stopped || !online) return Promise.resolve();
        for (const job of archive.due()) {
            if (active.size >= 4) break;
            if (active.has(job.key)) continue;
            const task = deliver(job).catch(() => {
                archive.retry(job.key, job.attempts);
                console.warn("[Recovery] Owner delivery incomplete; retained for retry.");
            }).finally(() => active.delete(job.key));
            active.set(job.key, task);
        }
        try {
            if (Date.now() - lastCleanup > 60000) {
                lastCleanup = Date.now();
                archive.cleanup();
            }
        } catch { console.error("[Recovery] Archive cleanup failed; storage requires attention."); }
        return Promise.all([...active.values()]);
    }
    const pump = () => { flush().catch(() => console.error("[Recovery] Queue scan failed; storage requires attention.")); };
    const upsert = ({ messages = [] }) => {
        try {
            // Capture the ENTIRE batch before handling any delete/edit in it.
            for (const msg of messages) capture(msg);
            for (const msg of messages) {
                const protocol = unwrap(msg.message)?.protocolMessage;
                if (protocol?.type !== 0 && protocol?.type !== 14) continue;
                const key = { ...protocol.key, remoteJid: protocol.key?.remoteJid || msg.key.remoteJid };
                queue(protocol.type === 0 ? "delete" : "edit", key, unwrap(protocol.editedMessage),
                    protocol.timestampMs ? Math.floor(Number(protocol.timestampMs) / 1000) : msg.messageTimestamp);
            }
            startDownloads();
            pump();
        } catch {
            console.error("[Recovery] Message capture failed; storage requires attention.");
        }
    };
    const update = (updates = []) => {
        try {
            for (const entry of updates) {
                if (entry.update?.messageStubType === revokeType) {
                    queue("delete", entry.key, undefined, entry.update.messageTimestamp);
                }
                else if (entry.update?.message) {
                    const message = unwrap(entry.update.message);
                    const protocol = message?.protocolMessage;
                    if (protocol?.type === 0) queue("delete", protocol.key || entry.key);
                    else if (protocol?.type === 14) queue("edit", protocol.key || entry.key, unwrap(protocol.editedMessage),
                        protocol.timestampMs ? Math.floor(Number(protocol.timestampMs) / 1000) : entry.update.messageTimestamp);
                    else if (!protocol) queue("edit", entry.key, message, entry.update.messageTimestamp);
                }
            }
            pump();
        } catch { console.error("[Recovery] Update capture failed; storage requires attention."); }
    };
    const connection = ({ connection }) => {
        online = connection === "open" || (connection !== "close" && online);
        if (online) pump();
        if (connection === "close") destroy();
    };
    function destroy() {
        stopped = true;
        clearInterval(timer);
        socket.ev.off("messages.upsert", upsert);
        socket.ev.off("messages.update", update);
        socket.ev.off("connection.update", connection);
    }
    socket.ev.on("messages.upsert", upsert);
    socket.ev.on("messages.update", update);
    socket.ev.on("connection.update", connection);
    const timer = setInterval(pump, retryMs);
    timer.unref?.();
    return { flush, destroy };
}

module.exports = { installMessageRecovery, textOf, connectedUserJid, timestampText };
