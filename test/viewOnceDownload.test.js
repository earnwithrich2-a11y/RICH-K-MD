const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { RecoveryArchive } = require("../RICHK-MD-core/connection/recoveryArchive");
const { recoverViewOnce, attachViewOnceStore, UNAVAILABLE } = require("../RICHK-MD-core/connection/viewOnceDownload");

function context(quoted, overrides = {}) {
    return {
        mek: { key: { remoteJid: "chat@g.us", remoteJidAlt: "verified@g.us" }, message: {
            extendedTextMessage: { contextInfo: { stanzaId: "original", participant: "100@s.whatsapp.net" } },
        } },
        quotedKey: { remoteJid: "forged@g.us", id: "original" },
        quoted, ...overrides,
    };
}

function original(type, media) {
    return { key: { remoteJid: "chat@g.us", id: "original", participant: "100@s.whatsapp.net" },
        message: { viewOnceMessageV2: { message: { [`${type}Message`]: media } } } };
}

for (const type of ["image", "video", "audio"]) {
    test(`opened ${type} recovers from saved bytes without any network URL or refresh request`, async () => {
        let calls = 0;
        const media = { ptt: type === "audio", mimetype: `${type}/test` };
        const socket = { viewOnceStore: {
            getMessage: async () => original(type, media),
            getMedia: async () => Buffer.from("saved before opening"),
        }, updateMediaMessage: async () => { throw new Error("Should not refresh a cached copy"); } };
        const result = await recoverViewOnce(socket, context({ viewOnceMessageV2: { message: {} } }), {
            save: async () => { calls++; throw new Error("Should not download"); },
        });
        assert.deepEqual(result[type], Buffer.from("saved before opening"));
        assert.equal(calls, 0);
        if (type === "audio") assert.equal(result.ptt, true);
    });
}

test("stripped quote metadata is repaired from the chat-scoped full original", async () => {
    const source = original("image", { directPath: "/original", mediaKey: Buffer.from("key"), caption: "original caption" });
    const lookups = [];
    const socket = { viewOnceStore: {
        getMessage: async (chat, id) => { lookups.push([chat, id]); return source; },
    } };
    const result = await recoverViewOnce(socket, context({ imageMessage: { viewOnce: true } }), {
        save: async (type, media) => {
            assert.equal(type, "imageMessage");
            assert.equal(media.directPath, "/original");
            assert.equal(media.caption, "original caption");
            return { image: Buffer.from("full") };
        },
    });
    assert.deepEqual(result.image, Buffer.from("full"));
    assert.deepEqual(lookups, [["chat@g.us", "original"]]);
});

test("missing paths refresh via the real message key and preserve the archived original", async () => {
    const source = original("video", { mediaKey: Buffer.from("key"), caption: "caption", mimetype: "video/mp4" });
    const socket = { viewOnceStore: { getMessage: async () => source }, updateMediaMessage: async envelope => {
        assert.deepEqual(envelope.key, source.key);
        assert.equal(envelope.message.videoMessage.viewOnce, false);
        envelope.message.videoMessage.directPath = "/refreshed";
        return envelope;
    } };
    const result = await recoverViewOnce(socket, context({ videoMessage: { viewOnce: true } }), {
        save: async (_type, media) => {
            assert.equal(media.directPath, "/refreshed");
            assert.equal(media.caption, "caption");
            return { video: Buffer.from("fresh video") };
        },
    });
    assert.deepEqual(result.video, Buffer.from("fresh video"));
    assert.equal(source.message.viewOnceMessageV2.message.videoMessage.directPath, undefined);
});

test("expired downloads retry only once after native refresh", async () => {
    let calls = 0, refreshes = 0;
    const media = { url: "https://example.test/expired", mediaKey: Buffer.from("key"), viewOnce: true };
    const socket = { updateMediaMessage: async envelope => {
        refreshes++;
        assert.equal(envelope.key.remoteJid, "chat@g.us");
        envelope.message.imageMessage.url = "https://example.test/fresh";
        return envelope;
    } };
    const result = await recoverViewOnce(socket, context({ imageMessage: media }), {
        save: async (_type, data) => {
            if (++calls === 1) throw Object.assign(new Error("expired"), { status: 410 });
            assert.equal(data.url, "https://example.test/fresh");
            return { image: Buffer.from("fresh") };
        },
    });
    assert.equal(calls, 2);
    assert.equal(refreshes, 1);
    assert.deepEqual(result.image, Buffer.from("fresh"));
});

test("cache lookups use only authenticated chat addresses, never a forged quoted chat", async () => {
    const lookups = [];
    const socket = { viewOnceStore: {
        getMessage: async (chat, id) => { lookups.push([chat, id]); return null; },
        getMedia: async chat => { assert.notEqual(chat, "forged@g.us"); return null; },
    } };
    await assert.rejects(recoverViewOnce(socket, context({ imageMessage: { viewOnce: true } })), {
        message: UNAVAILABLE,
    });
    assert.deepEqual(lookups.map(([chat]) => chat), ["chat@g.us", "verified@g.us"]);
});

test("a completed background copy can rescue a failed refresh", async () => {
    let reads = 0;
    const socket = { viewOnceStore: { getMedia: async () => ++reads > 2 ? Buffer.from("late copy") : null } };
    const result = await recoverViewOnce(socket, context({ imageMessage: { viewOnce: true } }));
    assert.deepEqual(result.image, Buffer.from("late copy"));
});

test("ordinary media and missing quotes are rejected without downloading", async () => {
    for (const quoted of [undefined, {}, { imageMessage: { url: "https://example.test/normal" } }]) {
        await assert.rejects(recoverViewOnce({}, context(quoted)), /Please reply to a view-once/);
    }
});

test("real read-only archive adapter returns full originals and enforces private cache-file bounds", async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "view-once-cache-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const name = "a".repeat(64);
    fs.writeFileSync(path.join(dir, name), "cached media");
    let row = { original: original("image", { url: "https://example.test/original" }), media: name };
    const socket = {};
    attachViewOnceStore(socket, {
        store: { loadMessage: () => null },
        archive: { dir, find: (chat, id) => chat === "chat@g.us" && id === "original" ? row : null },
    });
    assert.ok(socket.viewOnceStore.getMessage("chat@g.us", "original"));
    assert.deepEqual(await socket.viewOnceStore.getMedia("chat@g.us", "original"), Buffer.from("cached media"));
    assert.equal(await socket.viewOnceStore.getMedia("unrelated@g.us", "original"), null);
    row = { ...row, media: "../secret" };
    assert.equal(await socket.viewOnceStore.getMedia("chat@g.us", "original"), null);
});

test("an opened empty quote recovers the complete original from the real pre-existing recovery cache", async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "view-once-archive-"));
    const archive = new RecoveryArchive(dir);
    t.after(() => { archive.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    const source = original("audio", { mimetype: "audio/ogg", ptt: true, mediaKey: Buffer.from("key") });
    // No inner viewOnce flag: only the modern wrapper originally identified it.
    archive.capture(source);
    await archive.cacheMedia(archive.find("chat@g.us", "original"), async () =>
        Readable.from([Buffer.from("complete "), Buffer.from("voice note")]));
    const socket = {};
    attachViewOnceStore(socket, { store: { loadMessage: () => null }, archive });
    const result = await recoverViewOnce(socket, context({ viewOnceMessageV2Extension: { message: {} } }), {
        save: async () => { throw new Error("Must not require network after opening"); },
    });
    assert.deepEqual(result.audio, Buffer.from("complete voice note"));
    assert.equal(result.ptt, true);
    assert.equal(result.mimetype, "audio/ogg");
});
