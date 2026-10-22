const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { Readable } = require("stream");
const { RecoveryArchive, MEMORY_RETENTION_MS } = require("../RICHK-MD-core/connection/recoveryArchive");
const { installMessageRecovery } = require("../RICHK-MD-core/connection/messageRecovery");

const chat = "1000@s.whatsapp.net";
const connectedUser = "3000@s.whatsapp.net";
function original(id = "original", message = { conversation: "original text" }, jid = chat) {
    return {
        key: {
            id, remoteJid: jid, fromMe: false,
            participant: jid.endsWith("@g.us") ? "1000@s.whatsapp.net" : undefined,
        },
        message, pushName: "Test User", messageTimestamp: 1720000000,
    };
}
function protocol(type, id = "original", editedMessage, timestampMs) {
    return original("event", { protocolMessage: { type, key: { id, remoteJid: chat, fromMe: false }, editedMessage, timestampMs } });
}
function fixture(t, options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-test-"));
    const archive = new RecoveryArchive(dir);
    const sent = [];
    const socket = {
        ev: new EventEmitter(),
        user: { id: "3000:7@s.whatsapp.net" },
        signalRepository: { lidMapping: { getPNForLID: async () => undefined } },
        sendMessage: async (jid, content) => { sent.push({ jid, content }); },
    };
    const controller = installMessageRecovery(socket, {
        archive, getSettings: async () => ({ OWNER_NUMBER: "2000", ANTIDELETE: "indm", ANTI_EDIT: "indm" }),
        download: async () => Readable.from(Buffer.from("original media")),
        initiallyOnline: true, retryMs: 600000, ...options,
    });
    t.after(() => {
        controller.destroy();
        archive.db.close();
        fs.rmSync(dir, { force: true, recursive: true });
    });
    return { dir, archive, socket, sent, controller };
}

test("captures whole batch immediately, even when revoke appears before original", async t => {
    const f = fixture(t);
    f.socket.ev.emit("messages.upsert", { messages: [protocol(0), original()] });
    assert.equal(f.archive.find(chat, "original").original.message.conversation, "original text");
    await f.controller.flush();
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].jid, connectedUser);
    assert.match(f.sent[0].content.text, /original text/);
    assert.match(f.sent[0].content.text, /Timestamp: 2024-07-03T09:46:40\.000Z/);
    assert.match(f.sent[0].content.text, /Sender: @1000 \(Test User\)/);
    assert.deepEqual(f.sent[0].content.mentions, ["1000@s.whatsapp.net"]);
    assert.equal(f.archive.due().length, 0);
});

test("bootstrap registers RAM recovery before the general SQLite message store", () => {
    const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    const recovery = source.indexOf("installMessageRecovery(Gifted,");
    const store = source.indexOf("store.bind(Gifted.ev)");
    assert.ok(recovery >= 0 && store > recovery);
});

test("all incoming types enter the message-ID Map before the first SQLite write", async t => {
    const f = fixture(t, { initiallyOnline: false });
    const types = ["conversation", "imageMessage", "stickerMessage", "audioMessage", "videoMessage"];
    const batch = types.map(type => original(type, {
        [type]: type === "conversation" ? "text" : { mediaKey: Buffer.from("key"), ptt: type === "audioMessage" },
    }));
    const prepare = f.archive.db.prepare.bind(f.archive.db);
    f.archive.db.prepare = sql => {
        if (sql.startsWith("INSERT OR IGNORE INTO originals")) {
            for (const msg of batch) {
                assert.equal(f.archive.memory.has(msg.key.id), true);
                assert.deepEqual(f.archive.cached(chat, msg.key.id).original.message, msg.message);
            }
        }
        return prepare(sql);
    };
    f.socket.ev.emit("messages.upsert", { messages: batch });
    for (const msg of batch) assert.ok(f.archive.cached(chat, msg.key.id));
    batch[0].message.conversation = "mutated after capture";
    assert.equal(f.archive.find(chat, "conversation").original.message.conversation, "text");
});

test("RAM originals expire at two hours without refreshing on duplicates; disk recovery remains", async t => {
    const f = fixture(t, { initiallyOnline: false });
    f.archive.capture(original());
    const first = f.archive.cached(chat, "original");
    f.archive.capture(original("original", { conversation: "changed" }));
    assert.equal(f.archive.cached(chat, "original").cachedAt, first.cachedAt);
    assert.ok(f.archive.cached(chat, "original", first.cachedAt + MEMORY_RETENTION_MS - 1));
    assert.equal(f.archive.cached(chat, "original", first.cachedAt + MEMORY_RETENTION_MS), null);
    assert.equal(f.archive.memory.has("original"), false);
    assert.equal(f.archive.find(chat, "original").original.message.conversation, "original text");
});

test("memory expires while disconnected, and colliding IDs never cross chat boundaries", async t => {
    const f = fixture(t, { initiallyOnline: false });
    f.archive.capture(original());
    f.archive.capture(original("original", { conversation: "another chat" }, "9999@s.whatsapp.net"));
    assert.equal(f.archive.memory.get("original").size, 2);
    assert.equal(f.archive.find(chat, "original").original.message.conversation, "original text");
    assert.equal(f.archive.find("9999@s.whatsapp.net", "original").original.message.conversation, "another chat");
    assert.equal(f.archive.find("unrelated@s.whatsapp.net", "original"), null);
    f.archive.cached(chat, "original").cachedAt -= MEMORY_RETENTION_MS + 1;
    await f.controller.flush();
    assert.equal(f.archive.memory.get("original").has(chat), false);
    assert.equal(f.archive.memory.get("original").has("9999@s.whatsapp.net"), true);
});

test("verified alternate chat addresses recover originals without an unrestricted ID-only fallback", async t => {
    const f = fixture(t);
    const msg = original();
    msg.key.remoteJidAlt = "verified-peer@lid";
    f.socket.ev.emit("messages.upsert", { messages: [msg] });
    const revoke = protocol(0);
    revoke.message.protocolMessage.key.remoteJid = "verified-peer@lid";
    f.socket.ev.emit("messages.upsert", { messages: [revoke] });
    await f.controller.flush();
    assert.match(f.sent[0].content.text, /Original: original text/);
    assert.equal(f.archive.find("unknown-peer@lid", "original"), null);
    // The verified alias also works after eviction from RAM, as after restart.
    f.archive.memory.clear();
    assert.equal(f.archive.find("verified-peer@lid", "original").original.message.conversation, "original text");
});

test("a failed original SQLite write cannot stop immediate RAM capture or text recovery", async t => {
    const f = fixture(t);
    const prepare = f.archive.db.prepare.bind(f.archive.db);
    f.archive.db.prepare = sql => {
        if (sql.startsWith("INSERT OR IGNORE INTO originals")) throw new Error("Synthetic disk write failure");
        return prepare(sql);
    };
    f.socket.ev.emit("messages.upsert", { messages: [
        original(), original("second", { conversation: "second original" }), protocol(0),
    ] });
    assert.equal(f.archive.memory.has("original"), true);
    assert.equal(f.archive.memory.has("second"), true);
    await f.controller.flush();
    assert.match(f.sent[0].content.text, /🗑️ Recovered deleted message from @1000/);
    assert.match(f.sent[0].content.text, /Original: original text/);
});

test("group revoke identifies the admin deleter separately from the original author", async t => {
    const group = "4000@g.us";
    const f = fixture(t);
    const revoke = original("revoke", { protocolMessage: {
        type: 0, key: { id: "group-original", remoteJid: group, participant: "1000@s.whatsapp.net" },
    } }, group);
    revoke.key.participant = "admin@lid";
    revoke.key.participantAlt = "5000@s.whatsapp.net";
    f.socket.ev.emit("messages.upsert", { messages: [
        original("group-original", { conversation: "deleted by admin" }, group), revoke,
    ] });
    await f.controller.flush();
    assert.match(f.sent[0].content.text, /Recovered deleted message from @1000/);
    assert.match(f.sent[0].content.text, /Deleted by: @5000/);
    assert.deepEqual(f.sent[0].content.mentions, ["1000@s.whatsapp.net", "5000@s.whatsapp.net"]);
});

test("protocol revoke updates with an ID-only key inherit their chat from the SDK update", async t => {
    const f = fixture(t);
    f.socket.ev.emit("messages.upsert", { messages: [original()] });
    f.socket.ev.emit("messages.update", [{
        key: original().key,
        update: { message: { protocolMessage: { type: 0, key: { id: "original" } } } },
    }]);
    await f.controller.flush();
    assert.equal(f.sent.length, 1);
    assert.match(f.sent[0].content.text, /Original: original text/);
});

test("in-chat mode sends group recoveries to their original group", async t => {
    const group = "4000@g.us";
    const f = fixture(t, {
        getSettings: async () => ({ ANTIDELETE: "inchat", ANTI_EDIT: "inchat" }),
    });
    f.socket.ev.emit("messages.upsert", { messages: [
        original("group-message", { conversation: "group text" }, group),
        original("revoke", { protocolMessage: {
            type: 0, key: { id: "group-message", remoteJid: group, fromMe: false },
        } }, group),
    ] });
    await f.controller.flush();
    assert.equal(f.sent[0].jid, group);
    assert.match(f.sent[0].content.text, /group text/);
});

test("handles protocol 14 plus SDK editedMessage update once; keeps first original", async t => {
    const f = fixture(t);
    f.socket.ev.emit("messages.upsert", { messages: [original(), protocol(14, "original", { conversation: "new text" }, 100000)] });
    f.socket.ev.emit("messages.update", [{
        key: original().key,
        update: { message: { editedMessage: { message: { conversation: "new text" } } }, messageTimestamp: 100 },
    }]);
    await f.controller.flush();
    assert.equal(f.sent.length, 1);
    assert.match(f.sent[0].content.text, /Original: original text\nEdited to: new text/);
    f.socket.ev.emit("messages.upsert", { messages: [original("original", { conversation: "new text" })] });
    assert.equal(f.archive.find(chat, "original").original.message.conversation, "original text");
    f.socket.ev.emit("messages.upsert", { messages: [protocol(0)] });
    await f.controller.flush();
    assert.equal(f.sent.length, 2);
    assert.match(f.sent[1].content.text, /Original: original text/);
});

test("revoke updates are deduplicated with protocol events", async t => {
    const f = fixture(t);
    f.socket.ev.emit("messages.upsert", { messages: [original(), protocol(0)] });
    f.socket.ev.emit("messages.update", [{ key: original().key, update: { message: null, messageStubType: 1 } }]);
    await f.controller.flush();
    assert.equal(f.sent.length, 1);
});

for (const [type, field] of Object.entries({
    imageMessage: "image", audioMessage: "audio", videoMessage: "video", stickerMessage: "sticker", documentMessage: "document",
})) {
    test(`recovers original ${type}, preserves media attributes, not just text`, async t => {
        const f = fixture(t);
        const data = { caption: "old caption", ptt: true, mimetype: "test/type", fileName: "sample.bin" };
        f.socket.ev.emit("messages.upsert", { messages: [original("original", { [type]: data }), protocol(0)] });
        await f.controller.flush();
        assert.equal(f.sent.length, 2);
        assert.equal(f.sent[1].jid, connectedUser);
        const content = f.sent[1].content;
        assert.equal(fs.readFileSync(content[field].url).toString(), "original media");
        assert.equal(content.mimetype, "test/type");
        if (field === "audio") assert.equal(content.ptt, true);
        if (field === "document") assert.equal(content.fileName, "sample.bin");
    });
}

test("media recovery survives two-hour RAM eviction and preserves the actual bytes", async t => {
    const f = fixture(t);
    f.socket.ev.emit("messages.upsert", { messages: [
        original("original", { imageMessage: { caption: "saved image", mimetype: "image/png" } }),
    ] });
    await f.archive.cacheMedia(f.archive.find(chat, "original"), async () => Readable.from("original media"));
    f.archive.cached(chat, "original").cachedAt -= MEMORY_RETENTION_MS + 1;
    f.archive.pruneMemory();
    assert.equal(f.archive.memory.has("original"), false);
    f.socket.ev.emit("messages.upsert", { messages: [protocol(0)] });
    await f.controller.flush();
    assert.equal(f.sent.length, 2);
    assert.equal(fs.readFileSync(f.sent[1].content.image.url).toString(), "original media");
    assert.equal(f.sent[1].content.mimetype, "image/png");
});

test("owner alert is sent before stalled media download; unrelated chat still delivers", async t => {
    let release;
    const f = fixture(t, { download: () => new Promise(resolve => { release = resolve; }) });
    f.socket.ev.emit("messages.upsert", { messages: [original("original", { imageMessage: {} }), protocol(0)] });
    f.socket.ev.emit("messages.upsert", { messages: [
        original("other", { conversation: "other chat" }, "3000@g.us"),
        original("revoke-other", { protocolMessage: { type: 0, key: { id: "other", remoteJid: "3000@g.us" } } }),
    ] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.sent.length, 2);
    assert.match(f.sent[1].content.text, /other chat/);
    release(Readable.from("media"));
    await f.controller.flush();
    assert.equal(f.sent.length, 3);
});

test("failed owner delivery is persisted and retries without losing the original", async t => {
    const f = fixture(t);
    f.socket.sendMessage = async () => { throw new Error("offline"); };
    f.socket.ev.emit("messages.upsert", { messages: [original(), protocol(0)] });
    await f.controller.flush();
    assert.equal(f.archive.db.prepare("SELECT count(*) AS n FROM deliveries WHERE done = 0").get().n, 1);
    assert.ok(f.archive.find(chat, "original"));
    // A new archive connection, as after a restart, sees the queued delivery.
    const reopened = new RecoveryArchive(f.dir);
    assert.equal(reopened.db.prepare("SELECT count(*) AS n FROM deliveries WHERE done = 0").get().n, 1);
    reopened.db.close();
    f.archive.db.prepare("UPDATE deliveries SET next = 0").run();
    f.socket.sendMessage = async (jid, content) => f.sent.push({ jid, content });
    await f.controller.flush();
    assert.equal(f.sent.length, 1);
});

test("failed media send retries without repeating the already delivered alert", async t => {
    const f = fixture(t);
    let failures = 1;
    f.socket.sendMessage = async (jid, content) => {
        if (content.audio && failures--) throw new Error("send failed");
        f.sent.push({ jid, content });
    };
    f.socket.ev.emit("messages.upsert", { messages: [original("original", { audioMessage: { ptt: true } }), protocol(0)] });
    await f.controller.flush();
    assert.match(f.sent[0].content.text, /Original: \[audioMessage\]/);
    assert.match(f.sent[0].content.text, /Sender: @1000 \(Test User\)/);
    assert.deepEqual(f.sent[0].content.mentions, ["1000@s.whatsapp.net"]);
    f.archive.db.prepare("UPDATE deliveries SET next = 0").run();
    await f.controller.flush();
    assert.equal(f.sent.length, 2);
    assert.equal(f.sent.filter(item => item.content.text).length, 1);
    assert.equal(f.sent[1].content.ptt, true);
});

test("missing originals produce an honest notice, not silent loss", async t => {
    const f = fixture(t);
    f.socket.ev.emit("messages.upsert", { messages: [protocol(0)] });
    await f.controller.flush();
    assert.match(f.sent[0].content.text, /original was not received/);
});

test("disabled recovery respects owner setting, status and own messages are ignored", async t => {
    const f = fixture(t, { getSettings: async () => ({ ANTIDELETE: "off", ANTI_EDIT: "off" }) });
    f.socket.ev.emit("messages.upsert", { messages: [
        original(), protocol(0), { ...original("own"), key: { ...original("own").key, fromMe: true } },
        original("status", { conversation: "status" }, "status@broadcast"),
    ] });
    await f.controller.flush();
    assert.equal(f.sent.length, 0);
    assert.equal(f.archive.find(chat, "own"), null);
    assert.equal(f.archive.find("status@broadcast", "status"), null);
});

test("retention cleanup preserves pending originals and media", async t => {
    const f = fixture(t, { initiallyOnline: false });
    f.socket.ev.emit("messages.upsert", { messages: [original(), protocol(0), original("expired")] });
    f.archive.db.prepare("UPDATE originals SET created = 0").run();
    f.archive.cleanup();
    assert.ok(f.archive.find(chat, "original"));
    assert.equal(f.archive.find(chat, "expired"), null);
});
