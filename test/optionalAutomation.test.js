const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const { installOptionalAutomation, modeMatches } = require("../RICHK-MD-core/connection/optionalAutomation");
const { installAntiKick } = require("../RICHK-MD-core/connection/antiKick");
const { mediaContent } = require("../RICHK-MD-core/connection/automationMedia");

function message(id, jid = "100@s.whatsapp.net", content = { conversation: "hello" }, fromMe = false) {
    return { key: { id, remoteJid: jid, fromMe, participant: "100@s.whatsapp.net" }, message: content };
}

function fixture(t, settings = {}, overrides = {}) {
    const sent = [], read = [], presence = [], errors = [];
    const socket = {
        ev: new EventEmitter(), user: { id: "300:4@s.whatsapp.net" },
        sendMessage: async (...args) => sent.push(args),
        readMessages: async keys => read.push(keys),
        sendPresenceUpdate: async (...args) => presence.push(args),
    };
    const controller = installOptionalAutomation(socket, {
        getSettings: async () => settings, report: () => errors.push(true), ...overrides,
    });
    t.after(controller.destroy);
    const emit = async (event, data) => {
        await Promise.all(socket.ev.listeners(event).map(listener => listener(data)));
        await new Promise(resolve => setImmediate(resolve));
    };
    return { socket, controller, sent, read, presence, errors, emit,
        upsert: messages => emit("messages.upsert", { type: "notify", messages }) };
}

test("all optional actions are inert with missing/OFF settings, including after connection opens", async t => {
    const f = fixture(t);
    await f.emit("connection.update", { connection: "open" });
    await f.upsert([message("a"), message("b", "status@broadcast"),
        message("c", "200@s.whatsapp.net", { imageMessage: { viewOnce: true } })]);
    assert.deepEqual([f.sent, f.read, f.presence, f.errors], [[], [], [], []]);
});

test("status auto-view processes every status in a batch, ignores own status, and preserves original wrappers", async t => {
    const f = fixture(t, { AUTO_READ_STATUS: "true" });
    const wrapped = message("a", "status@broadcast", { ephemeralMessage: { message: { conversation: "status" } } });
    await f.upsert([wrapped, message("b", "status@broadcast"), message("own", "status@broadcast", {}, true)]);
    assert.equal(f.read.length, 2);
    assert.equal(f.sent.length, 0);
    assert.ok(wrapped.message.ephemeralMessage);
    await f.upsert([wrapped]);
    assert.equal(f.read.length, 2);
});

test("status likes require auto-view, carry a participant audience, and rate-limit repeat contacts", async t => {
    const settings = { AUTO_LIKE_STATUS: "true", STATUS_LIKE_EMOJIS: "❤️" };
    const f = fixture(t, settings);
    await f.upsert([message("off", "status@broadcast")]);
    assert.equal(f.sent.length, 0);
    settings.AUTO_READ_STATUS = "true";
    await f.upsert([message("a", "status@broadcast"), message("b", "status@broadcast")]);
    assert.equal(f.read.length, 2);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0][0], "status@broadcast");
    assert.equal(f.sent[0][1].react.text, "❤️");
    assert.deepEqual(f.sent[0][2], { statusJidList: ["100@s.whatsapp.net"] });
});

test("status replies retain their toggle and never fire with auto-view OFF", async t => {
    const settings = { AUTO_REPLY_STATUS: "true", STATUS_REPLY_TEXT: "Nice!" };
    const f = fixture(t, settings);
    await f.upsert([message("off", "status@broadcast")]);
    assert.equal(f.sent.length, 0);
    settings.AUTO_READ_STATUS = "true";
    await f.upsert([message("on", "status@broadcast")]);
    assert.deepEqual(f.sent[0], ["100@s.whatsapp.net", { text: "Nice!" }]);
});

test("auto-react handles phone, LID and group chats throughout batches without reacting to own/protocol/reaction traffic", async t => {
    const f = fixture(t, { AUTO_REACT: "all" });
    await f.upsert([message("a"), message("b", "200@lid"), message("c", "123@g.us"),
        message("own", "500@s.whatsapp.net", { conversation: "hello" }, true),
        message("revoke", "501@s.whatsapp.net", { protocolMessage: { type: 0 } }),
        message("reaction", "502@s.whatsapp.net", { reactionMessage: { text: "❤️" } }),
        message("status", "status@broadcast")]);
    assert.deepEqual(f.sent.map(args => args[0]), ["100@s.whatsapp.net", "200@lid", "123@g.us"]);
    await f.upsert([message("d")]); // Per-chat rate cap.
    assert.equal(f.sent.length, 3);
});

test("advertised auto-react commands mode honors the configured prefix", async t => {
    const f = fixture(t, { AUTO_REACT: "commands", PREFIX: "!" });
    await f.upsert([message("no"), message("yes", "200@lid", { conversation: "!ping" })]);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0][0], "200@lid");
    for (const [mode, group, command, expected] of [
        ["dm", false, false, true], ["dm", true, false, false],
        ["groups", true, false, true], ["commands", false, false, false],
        ["off", false, true, false],
    ]) assert.equal(modeMatches(mode, group, command), expected);
});

for (const mode of ["all", "dm", "groups", "commands", "off"]) {
    test(`auto-read ${mode} handles ordinary messages as well as commands, without reading own/status/protocol traffic`, async t => {
        const f = fixture(t, { AUTO_READ_MESSAGES: mode, PREFIX: "!" });
        await f.upsert([
            message("dm"), message("lid", "200@lid"), message("group", "123@g.us"),
            message("command", "201@lid", { conversation: "!ping" }),
            message("own", "202@lid", { conversation: "!ping" }, true),
            message("status", "status@broadcast"), message("revoke", "203@lid", { protocolMessage: { type: 0 } }),
        ]);
        const expected = { all: ["dm", "lid", "group", "command"], dm: ["dm", "lid", "command"],
            groups: ["group"], commands: ["command"], off: [] }[mode];
        assert.deepEqual(f.read.map(keys => keys[0].id), expected);
    });
}

test("automatic reaction budgets bound traffic across many chats", async t => {
    const f = fixture(t, { AUTO_REACT: "all" });
    await f.upsert(Array.from({ length: 50 }, (_, i) => message(`id${i}`, `${i}@lid`)));
    assert.equal(f.sent.length, 30);
});

test("a stalled read receipt never prevents another incoming-message listener from dispatching a command", async t => {
    const f = fixture(t, { AUTO_READ_MESSAGES: "all" });
    let dispatched = 0, started = 0;
    f.socket.readMessages = () => { started++; return new Promise(() => {}); };
    f.socket.ev.on("messages.upsert", () => { dispatched++; });
    f.socket.ev.emit("messages.upsert", { type: "notify",
        messages: [message("command", "100@lid", { conversation: ".ping" })] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started, 1);
    assert.equal(dispatched, 1);
});

test("view-once batches save every queued item with at most three simultaneous downloads", async t => {
    let active = 0, maximum = 0;
    const f = fixture(t, { ANTIVIEWONCE: "indm" }, { saveMedia: async () => {
        maximum = Math.max(maximum, ++active);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        return { image: Buffer.from("saved") };
    } });
    await f.upsert(Array.from({ length: 8 }, (_, i) =>
        message(`vo${i}`, "100@lid", { imageMessage: { viewOnce: true } })));
    assert.equal(f.sent.length, 8);
    assert.equal(maximum, 3);
    assert.equal(f.errors.length, 0);
});

test("historical append messages are ignored but fresh live append messages can react", async t => {
    const f = fixture(t, { AUTO_REACT: "all" });
    await f.emit("messages.upsert", { type: "append", messages: [message("undated"),
        { ...message("old"), messageTimestamp: 1 },
        { ...message("fresh"), messageTimestamp: { toNumber: () => Math.floor(Date.now() / 1000) } }] });
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0][1].react.key.id, "fresh");
});

test("fake recording/typing use existing per-chat presence modes and stop on socket close", async t => {
    const f = fixture(t, { DM_PRESENCE: "typing", GC_PRESENCE: "recording" });
    await f.upsert([message("a"), message("b", "123@g.us"), message("status", "status@broadcast")]);
    assert.deepEqual(f.presence, [["composing", "100@s.whatsapp.net"], ["recording", "123@g.us"]]);
    await f.emit("connection.update", { connection: "close" });
    assert.equal(f.socket.ev.listenerCount("messages.upsert"), 0);
    assert.equal(f.socket.ev.listenerCount("connection.update"), 0);
});

test("always-online reasserts availability only while connected and can be switched off", async t => {
    const settings = { ALWAYS_ONLINE: "true" };
    const f = fixture(t, settings);
    await f.controller.syncOnline();
    assert.equal(f.presence.length, 0);
    await f.emit("connection.update", { connection: "open" });
    assert.deepEqual(f.presence, [["available"]]);
    await f.controller.syncOnline();
    assert.deepEqual(f.presence.at(-1), ["available"]);
    settings.ALWAYS_ONLINE = "false";
    await f.controller.syncOnline();
    assert.deepEqual(f.presence.at(-1), ["unavailable"]);
    const count = f.presence.length;
    await f.controller.syncOnline();
    assert.equal(f.presence.length, count);
});

for (const type of ["image", "video", "audio"]) {
    test(`automatic view-once saves ${type} only to the connected account, not the sender/group`, async t => {
        const downloads = [];
        const f = fixture(t, { ANTIVIEWONCE: "indm" }, {
            saveMedia: async (kind, media) => { downloads.push([kind, media]); return { [type]: Buffer.from("saved") }; },
        });
        const incoming = message("vo", "123@g.us", {
            ephemeralMessage: { message: { viewOnceMessageV2: { message: {
                [`${type}Message`]: { viewOnce: true, mimetype: `${type}/test` },
            } } } },
        });
        await f.upsert([incoming, message("own", "100@s.whatsapp.net", incoming.message, true)]);
        assert.equal(downloads.length, 1);
        assert.equal(f.sent.length, 1);
        assert.equal(f.sent[0][0], "300@s.whatsapp.net");
        assert.ok(Buffer.isBuffer(f.sent[0][1][type]));
        assert.equal(downloads[0][1].viewOnce, true); // Original was not mutated.
        await f.upsert([incoming]);
        assert.equal(f.sent.length, 1);
    });
}

test("switching anti-view-once OFF during a download prevents later delivery", async t => {
    const settings = { ANTIVIEWONCE: "indm" };
    const f = fixture(t, settings, { saveMedia: async () => {
        settings.ANTIVIEWONCE = "off";
        return { image: Buffer.from("saved") };
    } });
    await f.upsert([message("a", "100@s.whatsapp.net", { imageMessage: { viewOnce: true } })]);
    assert.equal(f.sent.length, 0);
});

test("failed media actions are contained; an unrelated chat's auto-reaction still works", async t => {
    const f = fixture(t, { ANTIVIEWONCE: "indm", AUTO_REACT: "all" }, {
        saveMedia: async () => { throw new Error("expired"); },
    });
    await f.upsert([message("bad", "123@g.us", { imageMessage: { viewOnce: true } }), message("good")]);
    assert.equal(f.sent.length, 2); // Two reactions, no failed media copy.
    assert.equal(f.errors.length, 1);
});

test("media saving strips view-once, preserves voice-note metadata and bounds downloads", async () => {
    const source = { viewOnce: true, ptt: true, mimetype: "audio/ogg" };
    const content = await mediaContent("audioMessage", source, async (media, type, options) => {
        assert.equal(media.viewOnce, false);
        assert.equal(type, "audio");
        assert.equal(options.options.timeout, 20000);
        return Readable.from([Buffer.from("voice")]);
    });
    assert.equal(source.viewOnce, true);
    assert.deepEqual(content, { audio: Buffer.from("voice"), ptt: true, mimetype: "audio/ogg" });
    await assert.rejects(mediaContent("imageMessage", {}, async () => Readable.from([])), /empty/);
    await assert.rejects(mediaContent("imageMessage", {}, async () => Readable.from([Buffer.alloc(33 * 1024 * 1024)])), /32 MB/);
});

test("anti-kick checks the group toggle, fresh bot admin rights, bounded duplicate attempts and permission failures", async () => {
    const socket = { ev: new EventEmitter(), user: { id: "300:4@s.whatsapp.net" } };
    const adds = [], errors = [];
    let enabled = "false", admin = true, failures = false;
    socket.groupParticipantsUpdate = async (...args) => {
        adds.push(args);
        if (failures) throw new Error("403");
        return [{ status: "200" }];
    };
    const handle = installAntiKick(socket, {
        getSetting: async () => enabled,
        getMetadata: async (_socket, _jid, options) => {
            assert.equal(options.forceRefresh, true);
            return { participants: admin ? [{ id: "300@s.whatsapp.net", admin: "admin" }] : [] };
        }, report: () => errors.push(true),
    });
    const event = { id: "123@g.us", action: "remove", participants: ["100@s.whatsapp.net"], author: "900@s.whatsapp.net" };
    await handle(event);
    assert.equal(adds.length, 0);
    enabled = "true"; admin = false;
    await handle(event); // Includes bot removed / demoted.
    assert.equal(adds.length, 0);
    admin = true;
    await handle({ ...event, author: undefined });
    assert.equal(adds.length, 0);
    await handle({ ...event, author: "300:7@s.whatsapp.net" });
    assert.equal(adds.length, 0); // Do not undo the bot's anti-link/moderation removals.
    await handle(event);
    await handle(event);
    assert.deepEqual(adds, [["123@g.us", ["100@s.whatsapp.net"], "add"]]);
    failures = true;
    await handle({ ...event, participants: [{ id: "200@lid" }] });
    assert.equal(errors.length, 1);
    socket.ev.emit("connection.update", { connection: "close" });
    assert.equal(socket.ev.listenerCount("group-participants.update"), 0);
});
