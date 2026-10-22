const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { Readable } = require("stream");
const { RecoveryArchive } = require("../RICHK-MD-core/connection/recoveryArchive");
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
