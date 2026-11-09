const { safeParse, safeStringify } = require("../database/messageStore");
const { extractViewOnceMedia } = require("./viewOnceMedia");
const { unwrap } = require("./recoveryArchive");

const MIN_RETENTION_MS = 15 * 60 * 1000;

function completeMedia(message) {
    const content = unwrap(message?.message);
    const media = content?.imageMessage || content?.videoMessage || content?.audioMessage;
    return !!(media?.mediaKey && (media.url || media.directPath));
}

// Metadata only: no downloaded image/video/audio buffers are stored here.
// One raw original per message ID. JID/LID spelling never selects a cache entry.
class ViewOnceCache {
    constructor({ now = Date.now, retentionMs = MIN_RETENTION_MS, sweepMs = 60000 } = {}) {
        this.now = now;
        this.retentionMs = Math.max(MIN_RETENTION_MS, retentionMs);
        this.byId = new Map();
        this.expires = new Map();
        this.ambiguous = new Set();
        this.nextSweep = 0;
        if (sweepMs > 0) {
            this.timer = setInterval(() => this.sweep(), sweepMs);
            this.timer.unref?.();
        }
    }

    capture(message) {
        if (!message?.key?.id || !message.key.remoteJid || !extractViewOnceMedia(message.message)) return;
        if (this.now() >= this.nextSweep) {
            this.sweep();
            this.nextSweep = this.now() + 60000;
        }
        const { id } = message.key;
        if (this.ambiguous.has(id)) return;
        const existing = this.byId.get(id);
        if (existing && completeMedia(existing) && completeMedia(message)) {
            const previous = extractViewOnceMedia(existing.message);
            const next = extractViewOnceMedia(message.message);
            const sameHash = previous.media.fileSha256 && next.media.fileSha256 &&
                safeStringify(previous.media.fileSha256) === safeStringify(next.media.fileSha256);
            if (previous.mediaType !== next.mediaType ||
                (!sameHash && safeStringify(previous.media.mediaKey) !== safeStringify(next.media.mediaKey))) {
                // An actual ID collision must not choose somebody else's photo.
                this.byId.delete(id);
                this.ambiguous.add(id);
                return;
            }
        }
        // A stripped retransmission must never replace captured decryption keys.
        if (existing && this.expires.get(id) > this.now() &&
            (completeMedia(existing) || !completeMedia(message))) return;
        const copy = safeParse(safeStringify(message));
        this.byId.set(id, copy);
        this.expires.set(id, this.now() + this.retentionMs);
    }

    get(idOrChat, legacyId) {
        const id = legacyId || idOrChat;
        const message = this.byId.get(id);
        if (!message || this.expires.get(id) <= this.now()) {
            this.sweep();
            return null;
        }
        if (this.ambiguous.has(id)) return null;
        return safeParse(safeStringify(message));
    }

    sweep() {
        const time = this.now();
        for (const [id, expires] of this.expires) {
            if (expires <= time) {
                this.byId.delete(id);
                this.expires.delete(id);
                this.ambiguous.delete(id);
            }
        }
    }

    destroy() {
        clearInterval(this.timer);
        this.byId.clear();
        this.expires.clear();
        this.ambiguous.clear();
    }
}

module.exports = { ViewOnceCache, MIN_RETENTION_MS, completeMedia };
