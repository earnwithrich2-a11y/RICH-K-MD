const { safeParse, safeStringify } = require("../database/messageStore");
const { extractViewOnceMedia } = require("./viewOnceMedia");
const { mediaContent } = require("./automationMedia");
const { MIN_RETENTION_MS } = require("./viewOnceCache");

const keyOf = message => `${message.key.remoteJid}\0${message.key.id}`;

// Opt-in media bytes, separate from the always-on metadata cache and recovery.
class ViewOnceBuffers {
    constructor({ now = Date.now, maxBytes = 64 * 1024 * 1024, maxEntries = 128 } = {}) {
        this.now = now;
        this.maxBytes = maxBytes;
        this.maxEntries = maxEntries;
        this.entries = new Map();
        this.bytes = 0;
        this.generation = 0;
        this.timer = setInterval(() => this.sweep(), 60000);
        this.timer.unref?.();
    }
    remove(key) {
        const row = this.entries.get(key);
        if (row) this.bytes -= row.buffer.length;
        this.entries.delete(key);
    }
    put(original, content) {
        const found = extractViewOnceMedia(original.message);
        const type = found?.mediaType.replace(/Message$/, "");
        const buffer = content[type];
        if (!Buffer.isBuffer(buffer) || !buffer.length ||
            buffer.length > Math.min(this.maxBytes, 32 * 1024 * 1024)) return;
        this.sweep();
        const key = keyOf(original);
        this.remove(key);
        while (this.entries.size && (this.bytes + buffer.length > this.maxBytes ||
            this.entries.size >= this.maxEntries)) this.remove(this.entries.keys().next().value);
        this.entries.set(key, {
            original: safeParse(safeStringify(original)),
            buffer, expires: this.now() + MIN_RETENTION_MS,
        });
        this.bytes += buffer.length;
    }
    find(chat, id) {
        const row = this.entries.get(`${chat}\0${id}`) ||
            [...this.entries.values()].find(value =>
                value.original.key.id === id && value.original.key.remoteJidAlt === chat);
        return row && row.expires > this.now() ? row : null;
    }
    getMessage(chat, id) {
        const row = this.find(chat, id);
        return row ? safeParse(safeStringify(row.original)) : null;
    }
    getBuffer(chat, id) {
        const row = this.find(chat, id);
        return row ? Buffer.from(row.buffer) : null;
    }
    sweep() {
        for (const [key, row] of this.entries) if (row.expires <= this.now()) this.remove(key);
    }
    clear() {
        this.entries.clear();
        this.bytes = 0;
        this.generation++;
    }
    destroy() { clearInterval(this.timer); this.clear(); }
}

function createViewOncePrefetch(socket, { buffers, getSettings, save = mediaContent,
    waitMs = 5000, report = () => console.warn("[ViewOnce] Optional private prefetch failed or reached its limit.") }) {
    const pending = new Map();
    const queue = [];
    let active = 0;
    let closed = false;
    const enabled = async () => (await getSettings()).VIEW_ONCE_CACHE === "true";
    async function download(original) {
        const found = extractViewOnceMedia(original.message);
        if (!found) return null;
        try { return await save(found.mediaType, found.media); }
        catch (error) {
            if (!found.media.mediaKey || !socket.updateMediaMessage) throw error;
            const envelope = safeParse(safeStringify({
                ...original, message: { [found.mediaType]: { ...found.media, viewOnce: false } },
            }));
            const refreshed = await socket.updateMediaMessage(envelope);
            const media = (refreshed || envelope).message?.[found.mediaType];
            if (!media?.url && !media?.directPath) throw error;
            return save(found.mediaType, media);
        }
    }
    function start() {
        while (!closed && active < 2 && queue.length) {
            const job = queue.shift();
            active++;
            void job.work().then(job.resolve, job.reject).finally(() => { active--; start(); });
        }
    }
    function offer(original) {
        if (closed || !extractViewOnceMedia(original.message)) return Promise.resolve();
        const key = keyOf(original);
        if (pending.has(key)) return pending.get(key).promise;
        const generation = buffers.generation;
        const task = (async () => {
            if (!await enabled()) { buffers.clear(); return; }
            if (closed || generation !== buffers.generation || buffers.find(original.key.remoteJid, original.key.id)) return;
            if (queue.length >= 32) throw new Error("Queue is full");
            await new Promise((resolve, reject) => {
                queue.push({ resolve, reject, work: async () => {
                    if (closed || generation !== buffers.generation || !await enabled()) return;
                    const content = await download(original);
                    if (!closed && content && generation === buffers.generation && await enabled()) {
                        buffers.put(original, content);
                    }
                } });
                start();
            });
        })().catch(report).finally(() => pending.delete(key));
        pending.set(key, { promise: task, original });
        return task;
    }
    async function wait(chat, id) {
        if (!await enabled()) { buffers.clear(); return null; }
        const row = pending.get(`${chat}\0${id}`) || [...pending.values()].find(value =>
            value.original.key.id === id && value.original.key.remoteJidAlt === chat);
        if (row) {
            let timer;
            try {
                await Promise.race([row.promise, new Promise(resolve => {
                    timer = setTimeout(resolve, waitMs);
                    timer.unref?.();
                })]);
            } finally { clearTimeout(timer); }
        }
        return buffers.getBuffer(chat, id);
    }
    function close() {
        closed = true;
        for (const job of queue.splice(0)) job.resolve();
    }
    return { offer, wait, close };
}

module.exports = { ViewOnceBuffers, createViewOncePrefetch };
