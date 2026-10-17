const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { safeStringify, safeParse } = require("../database/messageStore");

const RETENTION_MS = 7 * 86400000;
const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

function unwrap(message) {
    for (let i = 0; message && i < 8; i++) {
        const inner = message.ephemeralMessage || message.viewOnceMessage ||
            message.viewOnceMessageV2 || message.documentWithCaptionMessage || message.editedMessage;
        if (!inner?.message) break;
        message = inner.message;
    }
    return message;
}

class RecoveryArchive {
    constructor(dir) {
        this.dir = dir;
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        for (const name of fs.readdirSync(dir)) {
            if (/^[a-f0-9]{64}\.part$/.test(name)) fs.unlinkSync(path.join(dir, name));
        }
        this.db = new Database(path.join(dir, "recovery.db"));
        this.db.pragma("journal_mode = WAL");
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS originals (
                key TEXT PRIMARY KEY, chat TEXT, id TEXT, data TEXT, created INTEGER, media TEXT
            );
            CREATE INDEX IF NOT EXISTS original_ids ON originals(id);
            CREATE TABLE IF NOT EXISTS deliveries (
                key TEXT PRIMARY KEY, data TEXT, done INTEGER DEFAULT 0,
                attempts INTEGER DEFAULT 0, next INTEGER DEFAULT 0, created INTEGER
            );
        `);
        this.memory = new Map();
        this.downloads = new Map();
        this.reservedBytes = 0;
    }
    key(chat, id) { return `${chat}\0${id}`; }
    capture(msg) {
        const message = unwrap(msg.message);
        if (!msg.key?.id || !msg.key.remoteJid || !message || message.protocolMessage ||
            msg.key.fromMe || msg.key.remoteJid === "status@broadcast") return;
        const key = this.key(msg.key.remoteJid, msg.key.id);
        // First write wins: edits/retransmissions must not replace the original.
        const copy = safeParse(safeStringify({ ...msg, message }));
        this.db.prepare("INSERT OR IGNORE INTO originals VALUES (?, ?, ?, ?, ?, NULL)")
            .run(key, msg.key.remoteJid, msg.key.id, safeStringify(copy), Date.now());
        if (!this.memory.has(key)) {
            const row = this.db.prepare("SELECT data FROM originals WHERE key = ?").get(key);
            this.memory.set(key, safeParse(row.data));
            if (this.memory.size > 10000) this.memory.delete(this.memory.keys().next().value);
        }
        return key;
    }
    find(chat, id) {
        const key = this.key(chat, id);
        const row = this.db.prepare("SELECT * FROM originals WHERE key = ?").get(key) ||
            this.db.prepare("SELECT * FROM originals WHERE id = ? ORDER BY created DESC LIMIT 1").get(id);
        return row ? { ...row, original: this.memory.get(row.key) || safeParse(row.data) } : null;
    }
    async cacheMedia(row, download) {
        if (!row || row.media) return;
        if (this.db.prepare("SELECT media FROM originals WHERE key = ?").get(row.key)?.media) return;
        if (this.downloads.has(row.key)) return this.downloads.get(row.key);
        const original = row.original;
        const media = ["imageMessage", "videoMessage", "audioMessage", "stickerMessage", "documentMessage"]
            .find(type => original.message[type]);
        if (!media) return;
        const size = Number(original.message[media].fileLength || 0);
        if (size > MAX_MEDIA_BYTES) throw new Error("Media exceeds recovery limit");
        let reserved = false;
        const task = (async () => {
            this.cleanup();
            const used = fs.readdirSync(this.dir).filter(name => /^[a-f0-9]{64}(\.part)?$/.test(name))
                .reduce((sum, name) => sum + fs.statSync(path.join(this.dir, name)).size, 0);
            // Pending recoveries are never evicted just to make room.
            if (used + this.reservedBytes + MAX_MEDIA_BYTES > MAX_ARCHIVE_BYTES) {
                throw new Error("Recovery media archive is full");
            }
            this.reservedBytes += MAX_MEDIA_BYTES;
            reserved = true;
            // Stream instead of buffering an unbounded video in RAM.
            const stream = await download(original, "stream", { options: { timeout: 20000 } });
            const name = crypto.createHash("sha256").update(row.key).digest("hex");
            const filename = path.join(this.dir, name);
            const temp = `${filename}.part`;
            let bytes = 0;
            const file = fs.createWriteStream(temp, { mode: 0o600 });
            const { pipeline } = require("stream/promises");
            const { Transform } = require("stream");
            try {
                await pipeline(stream, new Transform({
                    transform(chunk, encoding, done) {
                        bytes += chunk.length;
                        done(bytes > MAX_MEDIA_BYTES ? new Error("Media exceeds recovery limit") : null, chunk);
                    },
                }), file, { signal: AbortSignal.timeout(20000) });
                fs.renameSync(temp, filename);
                this.db.prepare("UPDATE originals SET media = ? WHERE key = ?").run(name, row.key);
            } finally {
                if (fs.existsSync(temp)) fs.unlinkSync(temp);
            }
        })();
        this.downloads.set(row.key, task);
        try { await task; } finally {
            if (reserved) this.reservedBytes -= MAX_MEDIA_BYTES;
            this.downloads.delete(row.key);
        }
    }
    enqueue(event) {
        this.db.prepare("INSERT OR IGNORE INTO deliveries (key, data, created) VALUES (?, ?, ?)")
            .run(event.key, safeStringify(event), Date.now());
    }
    due() {
        return this.db.prepare("SELECT * FROM deliveries WHERE done = 0 AND next <= ? ORDER BY created LIMIT 100")
            .all(Date.now()).map(row => ({ ...row, event: safeParse(row.data) }));
    }
    complete(key) { this.db.prepare("UPDATE deliveries SET done = 1 WHERE key = ?").run(key); }
    retry(key, attempts) {
        this.db.prepare("UPDATE deliveries SET attempts = attempts + 1, next = ? WHERE key = ?")
            .run(Date.now() + Math.min(60000, 1000 * 2 ** Math.min(attempts, 6)), key);
    }
    cleanup() {
        const pending = new Set(this.db.prepare("SELECT data FROM deliveries WHERE done = 0").all()
            .map(row => safeParse(row.data).originalKey));
        let total = fs.readdirSync(this.dir).filter(name => /^[a-f0-9]{64}$/.test(name))
            .reduce((sum, name) => sum + fs.statSync(path.join(this.dir, name)).size, 0);
        for (const row of this.db.prepare("SELECT key, media, created FROM originals ORDER BY created").all()) {
            if (pending.has(row.key)) continue;
            if (row.created >= Date.now() - RETENTION_MS && total <= MAX_ARCHIVE_BYTES) continue;
            if (row.media) {
                const file = path.join(this.dir, row.media);
                if (fs.existsSync(file)) { total -= fs.statSync(file).size; fs.unlinkSync(file); }
            }
            this.memory.delete(row.key);
            this.db.prepare("DELETE FROM originals WHERE key = ?").run(row.key);
        }
        this.db.prepare("DELETE FROM deliveries WHERE done = 1 AND created < ?").run(Date.now() - RETENTION_MS);
    }
}

module.exports = { RecoveryArchive, unwrap };
