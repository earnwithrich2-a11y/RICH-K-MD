const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { ViewOnceBuffers, createViewOncePrefetch } = require("../RICHK-MD-core/connection/viewOncePrefetch");
const { ViewOnceCache, MIN_RETENTION_MS } = require("../RICHK-MD-core/connection/viewOnceCache");
const { attachViewOnceStore, recoverViewOnce } = require("../RICHK-MD-core/connection/viewOnceDownload");

function original(id = "original", chat = "100@s.whatsapp.net", type = "image", fromMe = false) {
    const content = { viewOnceMessageV2: { message: {
        [`${type}Message`]: { mediaKey: Buffer.from("key"), directPath: "/media",
            mimetype: `${type}/test`, caption: type === "audio" ? undefined : "caption", ptt: type === "audio" },
    } } };
    return { key: { id, remoteJid: chat, fromMe }, message: fromMe ?
        { deviceSentMessage: { destinationJid: chat, message: content } } : content };
}

function fixture(t, { settings = {}, save, ...options } = {}) {
    const buffers = new ViewOnceBuffers(options);
    const errors = [];
    const socket = { ev: new EventEmitter(), sendMessage: async () => assert.fail("Prefetch must never send a message") };
    const controller = createViewOncePrefetch(socket, { buffers, getSettings: async () => settings,
        save: save || (async () => ({ image: Buffer.from("full media") })), report: () => errors.push(true) });
    t.after(() => { controller.close(); buffers.destroy(); });
    return { buffers, controller, socket, errors, settings };
}

test("prefetch is OFF without explicit opt-in and never downloads or forwards anything", async t => {
    let downloads = 0;
    const f = fixture(t, { save: async () => { downloads++; return { image: Buffer.from("bytes") }; } });
    await f.controller.offer(original());
    assert.equal(downloads, 0);
    assert.equal(f.buffers.entries.size, 0);
});

for (const type of ["image", "video", "audio"]) {
    test(`prefetch preserves outgoing linked-device ${type} bytes before opening without automatic DM delivery`, async t => {
        const f = fixture(t, { settings: { VIEW_ONCE_CACHE: "true" },
            save: async (mediaType, media) => {
                assert.equal(mediaType, `${type}Message`);
                assert.ok(media.mediaKey);
                return { [type]: Buffer.from(`complete ${type}`) };
            } });
        await f.controller.offer(original("original", "100@s.whatsapp.net", type, true));
        assert.deepEqual(await f.controller.wait("100@s.whatsapp.net", "original"), Buffer.from(`complete ${type}`));
        assert.ok(f.buffers.getMessage("100@s.whatsapp.net", "original").key.fromMe);
        assert.equal(f.errors.length, 0);
    });
}

test("bytes expire after 15 minutes and capacity evicts old copies without exceeding its byte budget", t => {
    let time = 1;
    const f = fixture(t, { now: () => time, maxBytes: 8, maxEntries: 2 });
    f.buffers.put(original("a"), { image: Buffer.from("12345") });
    f.buffers.put(original("b"), { image: Buffer.from("67890") });
    assert.equal(f.buffers.getBuffer("100@s.whatsapp.net", "a"), null);
    assert.deepEqual(f.buffers.getBuffer("100@s.whatsapp.net", "b"), Buffer.from("67890"));
    assert.equal(f.buffers.bytes, 5);
    time += MIN_RETENTION_MS;
    assert.equal(f.buffers.getBuffer("100@s.whatsapp.net", "b"), null);
    f.buffers.sweep();
    assert.equal(f.buffers.bytes, 0);
});

test("a disabled/cleared cache cannot be repopulated by an older download even if switched ON again", async t => {
    let release;
    const f = fixture(t, { settings: { VIEW_ONCE_CACHE: "true" }, save: async () => {
        await new Promise(resolve => { release = resolve; });
        return { image: Buffer.from("old") };
    } });
    const offered = f.controller.offer(original());
    await new Promise(resolve => setImmediate(resolve));
    f.settings.VIEW_ONCE_CACHE = "false";
    f.buffers.clear();
    f.settings.VIEW_ONCE_CACHE = "true";
    release();
    await offered;
    assert.equal(f.buffers.entries.size, 0);
});

test("download concurrency is bounded to two and duplicate packets share a single task", async t => {
    let active = 0, maximum = 0, downloads = 0;
    const f = fixture(t, { settings: { VIEW_ONCE_CACHE: "true" }, save: async () => {
        downloads++;
        maximum = Math.max(maximum, ++active);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        return { image: Buffer.from("bytes") };
    } });
    const jobs = [];
    for (let i = 0; i < 8; i++) {
        jobs.push(f.controller.offer(original(String(i))));
        jobs.push(f.controller.offer(original(String(i))));
    }
    await Promise.all(jobs);
    assert.equal(downloads, 8);
    assert.equal(maximum, 2);
});

test("the private cache isolates colliding IDs and honors only the original transport alias", async t => {
    const f = fixture(t, { settings: { VIEW_ONCE_CACHE: "true" } });
    const a = original("same", "100@s.whatsapp.net");
    a.key.remoteJidAlt = "100@lid";
    await f.controller.offer(a);
    assert.deepEqual(await f.controller.wait("100@lid", "same"), Buffer.from("full media"));
    assert.equal(await f.controller.wait("unrelated@g.us", "same"), null);
    assert.equal(f.buffers.getMessage("200@s.whatsapp.net", "same"), null);
});

test("native refresh can rescue an expired early download without mutating the captured original", async t => {
    let downloads = 0, refreshes = 0;
    const f = fixture(t, { settings: { VIEW_ONCE_CACHE: "true" }, save: async (_type, media) => {
        if (++downloads === 1) throw new Error("expired");
        assert.equal(media.directPath, "/fresh");
        return { image: Buffer.from("fresh bytes") };
    } });
    f.socket.updateMediaMessage = async envelope => {
        refreshes++;
        envelope.message.imageMessage.directPath = "/fresh";
        return envelope;
    };
    const source = original();
    await f.controller.offer(source);
    assert.equal(refreshes, 1);
    assert.equal(source.message.viewOnceMessageV2.message.imageMessage.directPath, "/media");
    assert.deepEqual(await f.controller.wait("100@s.whatsapp.net", "original"), Buffer.from("fresh bytes"));
});

test("end-to-end opened outgoing media recovers from prefetched bytes after all server downloads stop working", async t => {
    const buffers = new ViewOnceBuffers();
    const cache = new ViewOnceCache({ sweepMs: 0 });
    const socket = { ev: new EventEmitter() };
    let serverAvailable = true, downloads = 0;
    attachViewOnceStore(socket, {
        cache, buffers, store: { loadMessage: () => null }, archive: { find: () => null },
        getSettings: async () => ({ VIEW_ONCE_CACHE: "true" }),
        prefetchOptions: { save: async (mediaType, media) => {
            downloads++;
            assert.equal(mediaType, "imageMessage");
            assert.ok(media.mediaKey);
            if (!serverAvailable) throw new Error("410 already opened");
            return { image: Buffer.from("preserved original photo") };
        } },
    });
    t.after(() => { socket.viewOnceStore.dispose(); buffers.destroy(); cache.destroy(); });
    socket.ev.emit("messages.upsert", { type: "notify",
        messages: [original("original", "100@s.whatsapp.net", "image", true)] });
    await new Promise(resolve => setImmediate(resolve));
    await socket.viewOnceStore.getMedia("100@s.whatsapp.net", "original");
    serverAvailable = false;
    const result = await recoverViewOnce(socket, {
        m: { chat: "100@s.whatsapp.net", quoted: {
            id: "original", message: { viewOnceMessageV2: { message: { imageMessage: {} } } },
        } },
    }, { save: async () => assert.fail("Opened media must come from the private byte cache") });
    assert.deepEqual(result.image, Buffer.from("preserved original photo"));
    assert.equal(result.caption, "caption");
    assert.equal(downloads, 1);
});

test("old append history is metadata-only; fresh append messages can opt into byte prefetch", async t => {
    const buffers = new ViewOnceBuffers();
    const cache = new ViewOnceCache({ sweepMs: 0 });
    const socket = { ev: new EventEmitter() };
    let downloads = 0;
    attachViewOnceStore(socket, {
        cache, buffers, store: { loadMessage: () => null }, archive: { find: () => null },
        getSettings: async () => ({ VIEW_ONCE_CACHE: "true" }),
        prefetchOptions: { save: async () => { downloads++; return { image: Buffer.from("copy") }; } },
    });
    t.after(() => { socket.viewOnceStore.dispose(); buffers.destroy(); cache.destroy(); });
    socket.ev.emit("messages.upsert", { type: "append", messages: [
        { ...original("old"), messageTimestamp: 1 }, original("undated"),
        { ...original("fresh"), messageTimestamp: Math.floor(Date.now() / 1000) },
    ] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(downloads, 1);
    assert.ok(cache.get("100@s.whatsapp.net", "old"));
    assert.equal(buffers.getBuffer("100@s.whatsapp.net", "old"), null);
    assert.deepEqual(buffers.getBuffer("100@s.whatsapp.net", "fresh"), Buffer.from("copy"));
});
