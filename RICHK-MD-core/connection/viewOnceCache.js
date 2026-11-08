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
// IDs are the primary index; the chat sub-index prevents cross-chat collisions.
class ViewOnceCache {
    constructor({ now = Date.now, retentionMs = MIN_RETENTION_MS, sweepMs = 60000 } = {}) {
        this.now = now;
        this.retentionMs = Math.max(MIN_RETENTION_MS, retentionMs);
        this.byId = new Map();
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
        const { id, remoteJid: chat } = message.key;
        const existing = this.byId.get(id)?.get(chat);
        // A stripped retransmission must never replace captured decryption keys.
        if (existing && existing.expires > this.now() &&
            (completeMedia(existing.message) || !completeMedia(message))) return;
        const copy = safeParse(safeStringify(message));
        if (!this.byId.has(id)) this.byId.set(id, new Map());
        this.byId.get(id).set(chat, { message: copy, expires: this.now() + this.retentionMs });
    }

    get(chat, id) {
        const entries = this.byId.get(id);
        if (!entries) return null;
        const row = entries.get(chat) || [...entries.values()].find(entry =>
            entry.message.key.remoteJidAlt === chat);
        if (!row || row.expires <= this.now()) {
            this.sweep();
            return null;
        }
        return safeParse(safeStringify(row.message));
    }

    sweep() {
        const time = this.now();
        for (const [id, chats] of this.byId) {
            for (const [chat, row] of chats) if (row.expires <= time) chats.delete(chat);
            if (!chats.size) this.byId.delete(id);
        }
    }

    destroy() {
        clearInterval(this.timer);
        this.byId.clear();
    }
}

module.exports = { ViewOnceCache, MIN_RETENTION_MS, completeMedia };
