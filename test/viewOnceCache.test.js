const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { ViewOnceCache, MIN_RETENTION_MS } = require("../RICHK-MD-core/connection/viewOnceCache");
const { attachViewOnceStore, recoverViewOnce } = require("../RICHK-MD-core/connection/viewOnceDownload");

function original(id = "original", chat = "100@s.whatsapp.net", type = "image") {
    return {
        key: { id, remoteJid: chat },
        message: { viewOnceMessageV2Extension: { message: {
            [`${type}Message`]: {
                directPath: `/${chat}/${id}`, mediaKey: Buffer.from("unstripped key"),
                mimetype: `${type}/test`, ...(type === "audio" ? { ptt: true } : {}),
            },
        } } },
    };
}

function fixture(t, { now, loadMessage = () => null } = {}) {
    const cache = new ViewOnceCache({ now, sweepMs: 0 });
    const socket = { ev: new EventEmitter() };
    const reads = [];
    attachViewOnceStore(socket, {
        cache, store: { loadMessage },
        archive: { find: (chat, id) => { reads.push([chat, id]); return null; } },
    });
    t.after(() => { socket.viewOnceStore.dispose(); cache.destroy(); });
    return { cache, socket, reads };
}

test("the ID-keyed metadata map retains full originals for at least 15 minutes, then expires them", t => {
    let time = 1000;
    const { cache } = fixture(t, { now: () => time });
    cache.capture(original());
    assert.ok(cache.byId.has("original"));
    time += MIN_RETENTION_MS - 1;
    assert.deepEqual(cache.get("100@s.whatsapp.net", "original")
        .message.viewOnceMessageV2Extension.message.imageMessage.mediaKey, Buffer.from("unstripped key"));
    time++;
    assert.equal(cache.get("100@s.whatsapp.net", "original"), null);
    assert.equal(cache.byId.size, 0);
});

test("full metadata is synchronously captured for every message before downstream normalization can strip keys", t => {
    const { socket, cache } = fixture(t);
    socket.ev.on("messages.upsert", ({ messages }) => {
        for (const message of messages) {
            const media = Object.values(message.message.viewOnceMessageV2Extension.message)[0];
            delete media.mediaKey;
            delete media.directPath;
        }
    });
    socket.ev.emit("messages.upsert", {
        type: "notify", messages: ["image", "video", "audio"].map(type => original(type, "100@s.whatsapp.net", type)),
    });
    for (const type of ["image", "video", "audio"]) {
        const saved = cache.get("100@s.whatsapp.net", type);
        const media = saved.message.viewOnceMessageV2Extension.message[`${type}Message`];
        assert.ok(Buffer.isBuffer(media.mediaKey));
        assert.ok(media.directPath);
    }
});

test("ID-only cache lookup wins across JID changes, with async store fallback when no cached original exists", async t => {
    const lookups = [];
    const fromStore = original();
    fromStore.message.viewOnceMessageV2Extension.message.imageMessage.directPath = "/store-first";
    const { socket, cache, reads } = fixture(t, {
        loadMessage: async (chat, id) => { lookups.push([chat, id]); return fromStore; },
    });
    cache.capture(original());
    const result = await socket.viewOnceStore.getMessage("100@s.whatsapp.net", "original");
    assert.equal(result.message.viewOnceMessageV2Extension.message.imageMessage.directPath, "/100@s.whatsapp.net/original");
    assert.deepEqual(lookups, []);
    assert.ok(socket.viewOnceStore.getById("original"));
    cache.byId.clear();
    const fallback = await socket.viewOnceStore.getMessage("100@s.whatsapp.net", "original");
    assert.equal(fallback.message.viewOnceMessageV2Extension.message.imageMessage.directPath, "/store-first");
    assert.deepEqual(lookups, [["100@s.whatsapp.net", "original"]]);
    assert.deepEqual(reads, []);
});

test("unwrapped full image/video originals from the store are used before memory or stripped quoted media", async t => {
    for (const type of ["image", "video"]) {
        const source = original(type, "100@s.whatsapp.net", type);
        source.message = source.message.viewOnceMessageV2Extension.message;
        const { socket, reads } = fixture(t, { loadMessage: () => source });
        const result = await recoverViewOnce(socket, { m: {
            chat: "100@s.whatsapp.net",
            quoted: { id: type, message: { viewOnceMessageV2: { message: { [`${type}Message`]: {} } } } },
        } }, {
            save: async (mediaType, media) => {
                assert.equal(mediaType, `${type}Message`);
                assert.deepEqual(media.mediaKey, Buffer.from("unstripped key"));
                assert.ok(media.directPath);
                return { [type]: Buffer.from("complete media") };
            },
        });
        assert.deepEqual(result[type], Buffer.from("complete media"));
        // getMedia checks the durable byte cache, but getMessage must not need it.
        assert.equal(reads.length, 1);
    }
});

for (const failure of ["missing", "stripped", "throwing"]) {
    test(`memory originals recover full keys when the normal store is ${failure}`, async t => {
        const { socket, cache } = fixture(t, {
            loadMessage: () => {
                if (failure === "throwing") throw new Error("store unavailable");
                if (failure === "stripped") return {
                    key: original().key, message: { imageMessage: { viewOnce: true, directPath: "/stale", mediaKey: null } },
                };
                return null;
            },
        });
        socket.ev.emit("messages.upsert", { type: "notify", messages: [original()] });
        const result = await socket.viewOnceStore.getMessage("100@s.whatsapp.net", "original");
        assert.deepEqual(result, cache.get("100@s.whatsapp.net", "original"));
        assert.deepEqual(result.message.viewOnceMessageV2Extension.message.imageMessage.mediaKey,
            Buffer.from("unstripped key"));
    });
}

test("stripped retransmissions and returned-object mutation cannot erase the original keys or extend its lifetime", t => {
    let time = 1;
    const { cache } = fixture(t, { now: () => time });
    cache.capture(original());
    const returned = cache.get("100@s.whatsapp.net", "original");
    delete returned.message.viewOnceMessageV2Extension.message.imageMessage.mediaKey;
    time += MIN_RETENTION_MS - 1;
    cache.capture(returned);
    assert.ok(cache.get("100@s.whatsapp.net", "original").message.viewOnceMessageV2Extension.message.imageMessage.mediaKey);
    time++;
    assert.equal(cache.get("100@s.whatsapp.net", "original"), null);
});

test("a later complete original upgrades an incomplete entry and receives the full retention interval", t => {
    let time = 1;
    const { cache } = fixture(t, { now: () => time });
    const incomplete = original();
    delete incomplete.message.viewOnceMessageV2Extension.message.imageMessage.mediaKey;
    cache.capture(incomplete);
    time += 10000;
    cache.capture(original());
    time += MIN_RETENTION_MS - 1;
    assert.ok(cache.get("100@s.whatsapp.net", "original"));
});

test("the map uses IDs alone across JID/LID changes and rejects genuinely conflicting IDs", t => {
    const { cache } = fixture(t);
    const a = original("same", "100@s.whatsapp.net");
    a.key.remoteJidAlt = "100@lid";
    cache.capture(a);
    assert.ok(cache.byId.get("same").message);
    assert.ok(cache.get("same"));
    assert.ok(cache.get("100@s.whatsapp.net", "same").message.viewOnceMessageV2Extension.message.imageMessage);
    assert.ok(cache.get("100@lid", "same").message.viewOnceMessageV2Extension.message.imageMessage);
    assert.ok(cache.get("unrelated@g.us", "same").message.viewOnceMessageV2Extension.message.imageMessage);
    cache.capture(original("same", "200@s.whatsapp.net", "video"));
    assert.equal(cache.get("same"), null, "ambiguous IDs cannot choose an arbitrary photo");
});

test("reconnect removes old listeners without clearing the shared 15-minute cache", async t => {
    const { socket, cache } = fixture(t);
    socket.ev.emit("messages.upsert", { type: "append", messages: [original()] });
    socket.ev.emit("connection.update", { connection: "close" });
    assert.equal(socket.ev.listenerCount("messages.upsert"), 0);
    assert.equal(socket.ev.listenerCount("connection.update"), 0);
    assert.ok(cache.get("100@s.whatsapp.net", "original"));
    const replacement = { ev: new EventEmitter() };
    attachViewOnceStore(replacement, { cache, store: { loadMessage: () => null }, archive: { find: () => null } });
    t.after(replacement.viewOnceStore.dispose);
    assert.ok(await replacement.viewOnceStore.getMessage("100@s.whatsapp.net", "original"));
});

test("ordinary messages and protocol packets are not retained in the view-once metadata map", t => {
    const { socket, cache } = fixture(t);
    socket.ev.emit("messages.upsert", { type: "notify", messages: [
        { key: original().key, message: { conversation: "hello" } },
        { key: original().key, message: { imageMessage: { url: "https://example.test/normal" } } },
        { key: original().key, message: { protocolMessage: { type: 0 } } },
    ] });
    assert.equal(cache.byId.size, 0);
});
