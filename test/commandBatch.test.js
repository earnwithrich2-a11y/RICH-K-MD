const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { makeEventBuffer } = require("gifted-baileys/lib/Utils/event-buffer");
const { serializeMessage, standardizeJid } = require("../RICHK-MD-core/connection/serializer");

function dispatcherHarness(failFirstSettingsRead = false, ev = new EventEmitter(), { realSerializer = false, mode = "public" } = {}) {
    const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    const start = source.indexOf("function setupCommandHandler(");
    const end = source.indexOf("function setupGiftedHelpers(", start);
    const calls = [];
    const replies = [];
    let reads = 0;
    const settings = { PREFIX: ".", MODE: mode, BOT_PAUSED: "false" };
    const setup = vm.runInNewContext(
        `(() => { ${source.slice(start, end)} return setupCommandHandler; })()`,
        {
            processedMessages: new Set(),
            BOT_START_TIME: Date.now(),
            console: { info() {}, warn() {}, error() {} },
            setTimeout() {},
            async getAllSettings() {
                if (++reads === 1 && failFirstSettingsRead) throw new Error("Synthetic read failure");
                return settings;
            },
            standardizeJid: realSerializer ? standardizeJid : (jid) => jid,
            serializeMessage: realSerializer ? serializeMessage : async (ms) => {
                const body = ms.message.conversation;
                return {
                    from: ms.key.remoteJid,
                    isGroup: false,
                    body,
                    isCommand: body.startsWith("."),
                    command: body.slice(1).toLowerCase(),
                    args: [],
                    sender: "synthetic-sender",
                    messageAuthor: "synthetic-sender",
                };
            },
            findCommand: (pattern) => ({
                pattern,
                async function(from, socket, context) {
                    calls.push(context.fixtureId);
                    await socket.sendMessage(from, { text: `reply:${context.fixtureId}` });
                },
            }),
            getGroupInfo: async (_socket, _from, _botId, sender) => ({ sender }),
            buildSuperUsers: async () => realSerializer ? ["synthetic-bot@s.whatsapp.net"] : [],
            getSudoNumbers: async () => [],
            canShowCurrentChannelJid: () => false,
            findBodyCommand: () => null,
            createHelpers: () => ({}),
            setupGiftedHelpers() {},
            buildContext: (ms) => ({ fixtureId: ms.key.id }),
        },
    );
    const socket = {
        user: { id: realSerializer ? "synthetic-bot:7@s.whatsapp.net" : "synthetic-bot" }, ev,
        sendMessage: async (from, payload) => { replies.push({ from, payload }); },
    };
    setup(socket);
    return {
        calls,
        replies,
        receive: ev instanceof EventEmitter ? socket.ev.listeners("messages.upsert")[0] : undefined,
        socket,
    };
}

function message(id, body = ".ping") {
    return {
        key: { id, remoteJid: "synthetic-chat", fromMe: true },
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: body },
    };
}

test("each command in a buffered message batch reaches its handler", async () => {
    const harness = dispatcherHarness();
    await harness.receive({
        type: "notify",
        messages: [message("ordinary", "hello"), message("ping"), message("love", ".love")],
    });
    assert.deepEqual(harness.calls, ["ping", "love"]);
});

test("a skipped placeholder or old message cannot hide a later live command", async () => {
    const harness = dispatcherHarness();
    const old = message("old");
    old.messageTimestamp -= 3600;
    await harness.receive({
        type: "notify",
        messages: [
            { key: { id: "undecrypted" }, messageStubType: 2 },
            old,
            message("live"),
        ],
    });
    assert.deepEqual(harness.calls, ["live"]);
});

test("a fresh offline member command reaches the real dispatcher without waiting for receipts", async () => {
    const ev = makeEventBuffer({ trace() {}, debug() {} }, false);
    const harness = dispatcherHarness(false, ev);
    ev.buffer();
    const fresh = message("offline-command");
    fresh.key.fromMe = false;
    ev.emit("messages.upsert", { type: "append", messages: [fresh] });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(harness.calls, ["offline-command"]);
    assert.equal(harness.replies.length, 1);
    ev.flush();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(harness.calls, ["offline-command"]);
});

test("one failed message cannot abort the rest of its batch", async () => {
    const harness = dispatcherHarness(true);
    await harness.receive({
        type: "notify",
        messages: [message("failed"), message("next")],
    });
    assert.deepEqual(harness.calls, ["next"]);
});

const logger = { trace() {}, debug() {}, warn() {}, error() {} };
const drainHandlers = () => new Promise(resolve => setImmediate(resolve));

test("fresh commands run while background events remain buffered indefinitely", async () => {
    const ev = makeEventBuffer(logger, false);
    const harness = dispatcherHarness(false, ev);
    ev.buffer();
    ev.buffer();
    assert.equal(ev.isBuffering(), true);
    assert.equal(ev.isBufferingLiveMessages(), false);
    ev.emit("messages.upsert", {
        type: "notify", messages: [message("live-ping"), message("live-love", ".love")],
    });
    await drainHandlers();
    assert.deepEqual(harness.calls, ["live-ping", "live-love"]);
    assert.deepEqual(harness.replies.map(reply => reply.payload.text), ["reply:live-ping", "reply:live-love"]);
    ev.flush();
    ev.flush();
    await drainHandlers();
    assert.deepEqual(harness.calls, ["live-ping", "live-love"], "buffer completion must not replay commands");
    assert.equal(harness.replies.length, 2);
});

test("a live notification replaces its older queued copy without duplicate execution", async () => {
    const ev = makeEventBuffer(logger, false);
    const harness = dispatcherHarness(false, ev);
    const msg = message("same-command");
    ev.buffer();
    ev.emit("messages.upsert", { type: "append", messages: [msg] });
    ev.emit("messages.upsert", { type: "notify", messages: [msg] });
    await drainHandlers();
    assert.deepEqual(harness.calls, ["same-command"]);
    ev.flush();
    await drainHandlers();
    assert.deepEqual(harness.calls, ["same-command"]);
});

test("default SDK buffering and background event consolidation are preserved", () => {
    const ev = makeEventBuffer(logger);
    const delivered = [];
    ev.on("messages.upsert", value => delivered.push(value));
    ev.buffer();
    ev.emit("messages.upsert", { type: "notify", messages: [message("default-sdk")] });
    assert.equal(ev.isBufferingLiveMessages(), true);
    assert.equal(delivered.length, 0);
    ev.flush();
    assert.equal(delivered.length, 1);
});

for (const mode of ["public", "private"]) {
    for (const chat of ["synthetic-friend@s.whatsapp.net", "synthetic-friend@lid"]) {
        test(`own commands sent to another ${chat.endsWith("@lid") ? "LID" : "phone"} chat reply there in ${mode} mode`, async () => {
            const harness = dispatcherHarness(false, new EventEmitter(), { realSerializer: true, mode });
            const plain = message("outgoing-plain");
            plain.key.remoteJid = chat;
            const disappearing = message("outgoing-disappearing");
            disappearing.key.remoteJid = chat;
            disappearing.message = {
                ephemeralMessage: { message: { extendedTextMessage: { text: ".love" } } },
            };
            const deviceCopy = message("outgoing-device-copy");
            deviceCopy.key.remoteJid = chat;
            deviceCopy.message = {
                deviceSentMessage: {
                    destinationJid: chat,
                    message: { ephemeralMessage: { message: { conversation: ".goodnight" } } },
                },
            };
            await harness.receive({ type: "notify", messages: [plain, disappearing, deviceCopy] });
            assert.deepEqual(harness.calls, ["outgoing-plain", "outgoing-disappearing", "outgoing-device-copy"]);
            assert.deepEqual(harness.replies.map(reply => reply.from), [chat, chat, chat]);
        });
    }
}

test("supporting outgoing commands does not allow other people to bypass private mode", async () => {
    const harness = dispatcherHarness(false, new EventEmitter(), { realSerializer: true, mode: "private" });
    const incoming = message("incoming-guest");
    incoming.key.fromMe = false;
    incoming.key.remoteJid = "synthetic-friend@s.whatsapp.net";
    await harness.receive({ type: "notify", messages: [incoming] });
    assert.deepEqual(harness.calls, []);
    assert.deepEqual(harness.replies, []);
});
