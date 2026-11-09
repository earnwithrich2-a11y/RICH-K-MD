const fs = require("node:fs/promises");
const path = require("node:path");
const { unwrap } = require("./recoveryArchive");
const { safeParse, safeStringify } = require("../database/messageStore");
const { extractViewOnceMedia, hasViewOnceMarker } = require("./viewOnceMedia");
const { mediaContent, bufferContent } = require("./automationMedia");
const { ViewOnceCache, completeMedia } = require("./viewOnceCache");
const { createViewOncePrefetch } = require("./viewOncePrefetch");
const { normalizeIdentity } = require("./ownerIdentity");

const UNAVAILABLE = "This view-once media is no longer available. It may have been opened or expired, and the bot has no downloadable original or saved copy.";

function verifiedChats(socket, message) {
    const chats = new Set([message?.key?.remoteJid || message?.chat, message?.key?.remoteJidAlt].filter(Boolean));
    const own = [socket.user?.id, socket.user?.lid,
        socket.authState?.creds?.me?.id, socket.authState?.creds?.me?.lid]
        .map(normalizeIdentity).filter(Boolean);
    // Only a genuine self-chat may expand to the account's other login address.
    // fromMe alone is not enough: outgoing peer/group commands must stay scoped.
    if (own.includes(normalizeIdentity(message?.key?.remoteJid || message?.chat))) {
        for (const jid of own) chats.add(jid);
    }
    return [...chats];
}

function mediaQuality(media) {
    return Number(Boolean(media?.mediaKey)) * 2 + Number(Boolean(media?.url || media?.directPath));
}

// Owner-only manual recovery uses ID-only caches; durable store fallback stays scoped.
function attachViewOnceStore(socket, { store, archive, cache, buffers, getSettings, prefetchOptions = {} }) {
    const recent = cache || new ViewOnceCache();
    const prefetch = buffers && getSettings ?
        createViewOncePrefetch(socket, { buffers, getSettings, ...prefetchOptions }) : null;
    const capture = ({ messages = [], type }) => {
        for (const message of messages) {
            try {
                recent.capture(message);
                const original = recent.get(message.key?.id);
                const raw = message.messageTimestamp;
                const seconds = typeof raw?.toNumber === "function" ? raw.toNumber() : Number(raw?.low ?? raw);
                const freshAppend = type === "append" && seconds * 1000 >= Date.now() - 60000 &&
                    seconds * 1000 <= Date.now() + 30000;
                if (original && (type === "notify" || freshAppend)) void prefetch?.offer(original);
            }
            catch { console.warn("[ViewOnce] Could not cache incoming media metadata."); }
        }
    };
    const connection = ({ connection }) => {
        if (connection === "close") dispose();
    };
    function dispose() {
        socket.ev?.off("messages.upsert", capture);
        socket.ev?.off("connection.update", connection);
        prefetch?.close();
        // The process-wide cache must survive socket reconnects for its full TTL.
        if (!cache) recent.destroy();
    }
    // Install before store.bind and all message normalization/command listeners.
    socket.ev?.on("messages.upsert", capture);
    socket.ev?.on("connection.update", connection);
    socket.viewOnceStore = {
        getById(id) {
            if (recent.ambiguous.has(id)) return null;
            return recent.get(id) || buffers?.getMessage(id) || null;
        },
        async getMessage(chat, id) {
            const captured = recent.get(id);
            if (completeMedia(captured)) return captured;
            let saved;
            try { saved = await store.loadMessage(chat, id); } catch { /* Try the independent caches. */ }
            if (completeMedia(saved)) return saved;
            const prefetched = recent.ambiguous.has(id) ? null : buffers?.getMessage(id);
            if (prefetched) return prefetched;
            // Preserve the prior durable fallback for older messages.
            if (captured) return archive.find(chat, id)?.original || captured;
            return archive.find(chat, id)?.original || saved || null;
        },
        async getMedia(chat, id) {
            let privateCopy;
            try { if (!recent.ambiguous.has(id)) privateCopy = await prefetch?.wait(chat, id); }
            catch { /* Optional prefetch must not disable existing archived copies. */ }
            if (privateCopy) return privateCopy;
            const sourceChat = recent.get(id)?.key?.remoteJid || chat;
            const row = archive.find(sourceChat, id);
            if (!/^[a-f0-9]{64}$/.test(row?.media || "")) return null;
            const file = path.join(archive.dir, row.media);
            const stat = await fs.stat(file);
            if (!stat.size || stat.size > 32 * 1024 * 1024) return null;
            return fs.readFile(file);
        },
        clearMediaCache: () => buffers?.clear(),
        dispose,
    };
}

async function recoverViewOnce(socket, context, { save = mediaContent } = {}) {
    const message = context.mek || context.m || context;
    const info = unwrap(message?.message)?.extendedTextMessage?.contextInfo || {};
    const quoted = context.quotedMsg || context.quoted?.message || context.quoted ||
        message?.quoted?.message || info.quotedMessage;
    const id = context.quotedMessageContext?.stanzaId || context.contextInfo?.stanzaId ||
        info.stanzaId || context.quotedKey?.id || context.quoted?.id || message?.quoted?.id;
    // Only authenticated envelope addresses may select a store's conversation.
    const chats = verifiedChats(socket, message);
    const quotedMedia = extractViewOnceMedia(quoted);
    const originals = [];
    if (id) {
        try {
            const cached = await socket.viewOnceStore?.getById?.(id);
            if (cached?.message) {
                const found = extractViewOnceMedia(cached.message);
                if (found) originals.push({ ...found, original: cached, chat: cached.key?.remoteJid || chats[0] });
            }
        } catch { /* A broken cache must not discard a usable quote. */ }
    }
    if (id) for (const chat of chats) {
        try {
            const saved = await socket.viewOnceStore?.getMessage(chat, id);
            if (!saved?.message) continue;
            let found = extractViewOnceMedia(saved.message);
            if (!found && hasViewOnceMarker(quoted)) {
                const stored = unwrap(saved.message);
                const mediaType = ["imageMessage", "videoMessage", "audioMessage"].find(type => stored?.[type]);
                if (mediaType) found = { mediaType, media: stored[mediaType] };
            }
            if (!found) continue;
            originals.push({ ...found, original: saved, chat });
            // Do not stop at an empty/stripped record and hide a usable alias.
            if (mediaQuality(found.media) === 3) break;
        } catch { /* A cache failure must not prevent a fresh media download. */ }
    }
    originals.sort((a, b) => mediaQuality(b.media) - mediaQuality(a.media));
    const mediaType = originals[0]?.mediaType || quotedMedia?.mediaType;
    if (!mediaType) throw new Error("Please reply to a view-once image, video or audio message.");
    const candidates = originals.filter(item => item.mediaType === mediaType);
    if (quotedMedia?.mediaType === mediaType) candidates.push({
        ...quotedMedia, chat: chats[0], original: null,
    });
    // Keep complete sources intact. Never mix one version's key with another
    // version's URL, and never replace a good quote with stripped store fields.
    candidates.sort((a, b) => mediaQuality(b.media) - mediaQuality(a.media));
    const preferred = candidates[0];
    const statuses = new Set();
    function failed(error) {
        const code = Number(error?.response?.status || error?.output?.statusCode || error?.statusCode);
        if (Number.isInteger(code) && code >= 100 && code <= 599) statuses.add(code);
    }
    async function cachedContent() {
        if (!id) return null;
        for (const chat of new Set([...originals.map(item => item.chat), ...chats])) {
            const source = candidates.find(item => item.chat === chat) || preferred;
            try {
                const buffer = await socket.viewOnceStore?.getMedia(chat, id);
                if (buffer?.length) return bufferContent(mediaType, source.media, buffer);
            } catch { /* Expired/missing cache files do not disable network recovery. */ }
        }
        return null;
    }
    const cached = await cachedContent();
    if (cached) return cached;
    const attempted = new Set();
    for (const candidate of candidates) {
        const { media } = candidate;
        if (!media.url && !media.directPath) continue;
        // The source list is tiny, but identical quotes must not repeat a slow download.
        const fingerprint = safeStringify([media.mediaKey, media.url, media.directPath]);
        if (attempted.has(fingerprint)) continue;
        attempted.add(fingerprint);
        try { return await save(mediaType, media); }
        catch (error) { failed(error); }
    }
    const refreshSource = candidates.find(item => item.original?.key && item.media.mediaKey) ||
        candidates.find(item => item.media.mediaKey);
    if (id && chats[0] && refreshSource && typeof socket.updateMediaMessage === "function") {
        const { media, original, chat } = refreshSource;
        try {
            const key = original?.key || { ...context.quotedKey, remoteJid: chat || chats[0], id,
                participant: info.participant || context.quotedKey?.participant };
            // Native refresh mutates its envelope; never change archived originals.
            const envelope = safeParse(safeStringify({
                ...original, key, message: { [mediaType]: { ...media, viewOnce: false } },
            }));
            const refreshed = await socket.updateMediaMessage(envelope);
            const fresh = unwrap(refreshed?.message || envelope.message)?.[mediaType];
            if (fresh?.url || fresh?.directPath) return await save(mediaType, { ...media, ...fresh });
        } catch (error) { failed(error); }
    }
    // An early background download may have completed during the refresh attempt.
    const completed = await cachedContent();
    if (completed) return completed;
    const error = new Error(UNAVAILABLE);
    error.code = candidates.some(item => item.media.mediaKey)
        ? "VIEW_ONCE_DOWNLOAD_FAILED" : "VIEW_ONCE_KEYS_MISSING";
    console.warn(`[ViewOnce] Recovery unavailable: reason=${error.code}; originalFound=${originals.length > 0}; ` +
        `mediaPath=${candidates.some(item => item.media.url || item.media.directPath)}; ` +
        `downloadAttempted=${attempted.size > 0}; httpStatus=${[...statuses].join(",") || "unknown"}.`);
    throw error;
}

module.exports = { attachViewOnceStore, recoverViewOnce, UNAVAILABLE };
