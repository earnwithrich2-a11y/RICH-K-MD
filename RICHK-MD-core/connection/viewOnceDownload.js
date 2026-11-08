const fs = require("node:fs/promises");
const path = require("node:path");
const { unwrap } = require("./recoveryArchive");
const { safeParse, safeStringify } = require("../database/messageStore");
const { extractViewOnceMedia, hasViewOnceMarker } = require("./viewOnceMedia");
const { mediaContent, bufferContent } = require("./automationMedia");

const UNAVAILABLE = "This view-once media is no longer available. It may have been opened or expired, and the bot has no downloadable original or saved copy.";

// Read-only access to existing, chat-scoped stores. Never search by ID alone.
function attachViewOnceStore(socket, { store, archive }) {
    socket.viewOnceStore = {
        getMessage(chat, id) {
            let saved;
            try { saved = store.loadMessage(chat, id); } catch { /* Try the independent recovery archive. */ }
            const full = extractViewOnceMedia(saved?.message);
            if (full?.media.url || full?.media.directPath) return saved;
            return archive.find(chat, id)?.original || saved || null;
        },
        async getMedia(chat, id) {
            const row = archive.find(chat, id);
            if (!/^[a-f0-9]{64}$/.test(row?.media || "")) return null;
            const file = path.join(archive.dir, row.media);
            const stat = await fs.stat(file);
            if (!stat.size || stat.size > 32 * 1024 * 1024) return null;
            return fs.readFile(file);
        },
    };
}

async function recoverViewOnce(socket, context, { save = mediaContent } = {}) {
    const message = context.mek || context.m;
    const info = message?.message?.extendedTextMessage?.contextInfo || {};
    const quoted = context.quotedMsg || context.quoted || info.quotedMessage;
    const id = info.stanzaId || context.quotedKey?.id;
    // Only authenticated envelope addresses may select a store's conversation.
    const chats = [...new Set([message?.key?.remoteJid, message?.key?.remoteJidAlt].filter(Boolean))];
    let original, originalChat;
    if (id) for (const chat of chats) {
        try {
            const saved = await socket.viewOnceStore?.getMessage(chat, id);
            if (saved?.message) { original = saved; originalChat = chat; break; }
        } catch { /* A cache failure must not prevent a fresh media download. */ }
    }
    const stored = unwrap(original?.message);
    let viewOnce = extractViewOnceMedia(original?.message);
    // The recovery archive unwraps envelopes. An opened/empty quote still
    // supplies the view-once marker, while its original supplies the media type.
    if (!viewOnce && hasViewOnceMarker(quoted) && stored) {
        const mediaType = ["imageMessage", "videoMessage", "audioMessage"].find(type => stored[type]);
        if (mediaType) viewOnce = { mediaType, media: stored[mediaType] };
    }
    viewOnce ||= extractViewOnceMedia(quoted);
    if (!viewOnce) throw new Error("Please reply to a view-once image, video or audio message.");
    // Quotes can lose URL, directPath or mediaKey after opening. Prefer the full
    // captured original, but never replace it with a similarly named media type.
    if (stored?.[viewOnce.mediaType]) {
        viewOnce = { mediaType: viewOnce.mediaType, media: stored[viewOnce.mediaType] };
    }
    const { mediaType, media } = viewOnce;
    async function cachedContent() {
        if (!id) return null;
        for (const chat of originalChat ? [originalChat] : chats) {
            try {
                const buffer = await socket.viewOnceStore?.getMedia(chat, id);
                if (buffer?.length) return bufferContent(mediaType, media, buffer);
            } catch { /* Expired/missing cache files do not disable network recovery. */ }
        }
        return null;
    }
    const cached = await cachedContent();
    if (cached) return cached;
    if (media.url || media.directPath) {
        try { return await save(mediaType, media); }
        catch { /* Try the native, authenticated media-refresh request once. */ }
    }
    if (id && chats[0] && media.mediaKey && typeof socket.updateMediaMessage === "function") {
        try {
            const key = original?.key || { ...context.quotedKey, remoteJid: chats[0], id,
                participant: info.participant || context.quotedKey?.participant };
            // Native refresh mutates its envelope; never change archived originals.
            const envelope = safeParse(safeStringify({
                ...original, key, message: { [mediaType]: { ...media, viewOnce: false } },
            }));
            const refreshed = await socket.updateMediaMessage(envelope);
            const fresh = unwrap(refreshed?.message || envelope.message)?.[mediaType];
            if (fresh?.url || fresh?.directPath) return await save(mediaType, { ...media, ...fresh });
        } catch { /* Opening/expiration can make reupload unavailable. */ }
    }
    // An early background download may have completed during the refresh attempt.
    const completed = await cachedContent();
    if (completed) return completed;
    throw new Error(UNAVAILABLE);
}

module.exports = { attachViewOnceStore, recoverViewOnce, UNAVAILABLE };
