const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

function dispatcherHarness(failFirstSettingsRead = false) {
    const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
    const start = source.indexOf("function setupCommandHandler(");
    const end = source.indexOf("function setupGiftedHelpers(", start);
    const calls = [];
    let reads = 0;
    const settings = { PREFIX: ".", MODE: "public", BOT_PAUSED: "false" };
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
            standardizeJid: (jid) => jid,
            async serializeMessage(ms) {
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
                async function(_from, _socket, context) { calls.push(context.fixtureId); },
            }),
            getGroupInfo: async () => ({ sender: "synthetic-sender" }),
            buildSuperUsers: async () => [],
            getSudoNumbers: async () => [],
            canShowCurrentChannelJid: () => false,
            findBodyCommand: () => null,
            createHelpers: () => ({}),
            setupGiftedHelpers() {},
            buildContext: (ms) => ({ fixtureId: ms.key.id }),
        },
    );
    const socket = { user: { id: "synthetic-bot" }, ev: new EventEmitter() };
    setup(socket);
    return {
        calls,
        receive: socket.ev.listeners("messages.upsert")[0],
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

test("one failed message cannot abort the rest of its batch", async () => {
    const harness = dispatcherHarness(true);
    await harness.receive({
        type: "notify",
        messages: [message("failed"), message("next")],
    });
    assert.deepEqual(harness.calls, ["next"]);
});
