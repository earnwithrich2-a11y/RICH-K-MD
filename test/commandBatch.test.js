const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { makeEventBuffer } = require("gifted-baileys/lib/Utils/event-buffer");
const { serializeMessage, standardizeJid } = require("../RICHK-MD-core/connection/serializer");

function dispatcherHarness(failFirstSettingsRead = false, ev = new EventEmitter(), {
    realSerializer = false, mode = "public", ownerNumber = "", echoReplies = false,
} = {}) {
    const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    const start = source.indexOf("function setupCommandHandler(");
    const end = source.indexOf("function setupGiftedHelpers(", start);
    const calls = [];
    const replies = [];
    let reads = 0;
    const settings = { PREFIX: ".", MODE: mode, BOT_PAUSED: "false", OWNER_NUMBER: ownerNumber };
    const setup = vm.runInNewContext(
        `(() => { ${source.slice(start, end)} return setupCommandHandler; })()`,
        {
            installAutomatedMessageGuard: require("../RICHK-MD-core/connection/automatedMessageGuard").installAutomatedMessageGuard,
            processedMessages: new Set(),
            BOT_START_TIME: Date.now(),
            console: { info() {}, warn() {}, error() {} },
            setTimeout() {},
            runCommandOutput: require("../RICHK-MD-core/branding").runCommandOutput,
            menuPromo: { maybeSend: async () => false },
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
        sendMessage: async (from, payload, options) => {
            replies.push({ from, payload });
            const sent = {
                key: { remoteJid: from, fromMe: true, id: options?.messageId },
                message: { conversation: echoReplies ? ".ping" : payload.text },
                messageTimestamp: Math.floor(Date.now() / 1000),
            };
            if (echoReplies) {
                if (replies.length > 4) throw new Error("Automated reply loop");
                await socket.ev.listeners("messages.upsert")[0]({ messages: [sent], type: "notify" });
            }
            return sent;
        },
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

test("human own-account commands execute in self-chat, peer chats and groups in either mode", async () => {
    for (const mode of ["public", "private"]) {
        const f = dispatcherHarness(false, new EventEmitter(), { realSerializer: true, mode });
        f.socket.user.lid = "synthetic-own:7@lid";
        for (const [i, remoteJid] of [
            "synthetic-bot@s.whatsapp.net", "synthetic-own@lid",
            "synthetic-friend@s.whatsapp.net", "synthetic-group@g.us",
        ].entries()) {
            const ms = message(`BAE5-human-${mode}-${i}`);
            ms.key.remoteJid = remoteJid;
            await f.receive({ messages: [ms], type: "notify" });
        }
        assert.equal(f.calls.length, 4);
        assert.deepEqual(f.replies.map(r => r.from), [
            "synthetic-bot@s.whatsapp.net", "synthetic-bot@s.whatsapp.net",
            "synthetic-friend@s.whatsapp.net", "synthetic-group@g.us",
        ]);
    }
});

test("fromMe commands marked by Baileys reach self-chat and device-suffixed peer chats", async () => {
    const f = dispatcherHarness(false, new EventEmitter(), {
        realSerializer: true, mode: "private",
    });
    const routes = [
        [".menu", "synthetic-bot:9@s.whatsapp.net", "synthetic-bot@s.whatsapp.net"],
        [".ping", "synthetic-friend:12@s.whatsapp.net", "synthetic-friend@s.whatsapp.net"],
        [".settings", "synthetic-bot@s.whatsapp.net", "synthetic-bot@s.whatsapp.net"],
        [".alive", "synthetic-friend@s.whatsapp.net", "synthetic-friend@s.whatsapp.net"],
    ];

    for (const [index, [body, remoteJid]] of routes.entries()) {
        const ms = message(`self-command-${index}`, body);
        ms.key.remoteJid = remoteJid;
        ms.key.fromMe = true;
        ms.isBaileys = true;
        await f.receive({ messages: [ms], type: "notify" });
    }

    assert.deepEqual(f.calls, routes.map((_, index) => `self-command-${index}`));
    assert.deepEqual(f.replies.map(reply => reply.from), routes.map(([, , destination]) => destination));
});

test("incoming owner commands delivered as fresh append events are allowed in private mode", async () => {
    const f = dispatcherHarness(false, new EventEmitter(), {
        realSerializer: true, mode: "private", ownerNumber: "15550000002",
    });
    const ms = message("owner-append");
    Object.assign(ms.key, { fromMe: false, remoteJid: "15550000002@s.whatsapp.net" });
    await f.receive({ messages: [ms], type: "append" });
    assert.deepEqual(f.calls, ["owner-append"]);
    assert.equal(f.replies[0].from, "15550000002@s.whatsapp.net");
    const stranger = message("stranger-private");
    Object.assign(stranger.key, { fromMe: false, remoteJid: "15550000003@s.whatsapp.net" });
    await f.receive({ messages: [stranger], type: "notify" });
    assert.equal(f.calls.length, 1);
});

test("owner LID commands require a verified phone mapping and self-chat works without fromMe", async () => {
    const f = dispatcherHarness(false, new EventEmitter(), {
        realSerializer: true, mode: "private", ownerNumber: "15550000002",
    });
    f.socket.signalRepository = {
        lidMapping: { getPNForLID: async lid => lid === "verified-owner@lid" ? "15550000002@s.whatsapp.net" : undefined },
    };
    for (const [id, remoteJid] of [
        ["verified-owner", "verified-owner@lid"],
        ["unverified-lid", "15550000002@lid"],
        ["self-without-flag", "synthetic-bot@s.whatsapp.net"],
    ]) {
        const ms = message(id);
        Object.assign(ms.key, { fromMe: false, remoteJid });
        await f.receive({ messages: [ms], type: "append" });
    }
    assert.deepEqual(f.calls, ["verified-owner", "self-without-flag"]);
    assert.equal(f.replies[0].from, "verified-owner@lid");
    assert.equal(f.replies[1].from, "synthetic-bot@s.whatsapp.net");
});

test("old owner command history is not replayed", async () => {
    const f = dispatcherHarness(false, new EventEmitter(), {
        realSerializer: true, mode: "private", ownerNumber: "15550000002",
    });
    const ms = message("old-owner");
    Object.assign(ms.key, { fromMe: false, remoteJid: "15550000002@s.whatsapp.net" });
    ms.messageTimestamp -= 60;
    await f.receive({ messages: [ms], type: "append" });
    assert.equal(f.calls.length, 0);
});

test("self-chat and own status commands use credential identity when socket.user is unavailable", async () => {
    const f = dispatcherHarness(false, new EventEmitter(), { realSerializer: true, mode: "private" });
    f.socket.user = undefined;
    f.socket.authState = { creds: { me: { id: "synthetic-bot:7@s.whatsapp.net", lid: "synthetic-own@lid" } } };
    for (const [i, remoteJid] of ["synthetic-bot@s.whatsapp.net", "synthetic-own@lid", "status@broadcast"].entries()) {
        const ms = message(`own-notes-${i}`);
        ms.key.remoteJid = remoteJid;
        await f.receive({ messages: [ms], type: "append" });
    }
    assert.equal(f.calls.length, 3);
    assert.ok(f.replies.every(r => r.from === "synthetic-bot@s.whatsapp.net"));
});

test("synchronously echoed prefixed bot replies cannot loop, while a second human command still runs", async () => {
    const f = dispatcherHarness(false, new EventEmitter(), { realSerializer: true, echoReplies: true });
    for (const id of ["BAE5-human-first", "3EB0-human-second"]) {
        const ms = message(id);
        ms.key.remoteJid = "synthetic-bot@s.whatsapp.net";
        await f.receive({ messages: [ms], type: "notify" });
        // Re-delivered copies of the same human command must not execute twice.
        await f.receive({ messages: [ms], type: "notify" });
    }
    assert.deepEqual(f.calls, ["BAE5-human-first", "3EB0-human-second"]);
    assert.equal(f.replies.length, 2);
});

test("explicit automated messages and unprefixed own chatter never execute commands", async () => {
    const f = dispatcherHarness(false, new EventEmitter(), { realSerializer: true });
    await f.receive({
        type: "notify",
        messages: [
            { ...message("flagged-self-command", ".menu"), isBaileys: true },
            { ...message("plain-own", "hello"), isBaileys: true },
        ],
    });
    assert.deepEqual(f.calls, ["flagged-self-command"]);
    assert.equal(f.replies.length, 1);
});

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
