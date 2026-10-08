const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const binary = require("gifted-baileys/lib/WABinary");
const { makeEventBuffer } = require("gifted-baileys/lib/Utils/event-buffer");

const logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

function upsertHarness(config = { syncAppState: false }) {
    const source = fs.readFileSync(require.resolve("gifted-baileys/lib/Socket/chats"), "utf8");
    const start = source.indexOf("const upsertMessage = ev.createBufferedFunction(");
    const end = source.indexOf("\n    ws.on('CB:presence'", start);
    assert.ok(start >= 0 && end > start);
    const ev = makeEventBuffer(logger, false);
    const processed = [];
    const authState = { creds: { myAppStateKeyId: "synthetic-key-id" }, keys: {} };
    let syncs = 0;
    ev.on("creds.update", update => Object.assign(authState.creds, update));
    const context = {
        ev, config, logger, authState,
        pendingAppStateSync: false, needToFlushWithAppStateSync: false,
        shouldSyncHistoryMessage: () => false,
        Defaults_1: { PROCESSABLE_HISTORY_TYPES: [0] },
        Types_1: { ALL_WA_PATCH_NAMES: [] },
        Utils_1: {
            getHistoryMsg: content => content?.protocolMessage?.historySyncNotification,
        },
        placeholderResendCache: {},
        resyncAppState: async () => { syncs += 1; },
        finishAppStateBuffer() {},
        process_message_1: {
            default: async (msg, options) => {
                processed.push({ msg, shouldProcessHistoryMsg: options.shouldProcessHistoryMsg });
                // Key-share processing remains independent of passive account sync.
                if (msg.message?.protocolMessage?.appStateSyncKeyShare) {
                    ev.emit("creds.update", { myAppStateKeyId: "new-synthetic-key-id" });
                }
            },
        },
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end) + "\nthis.upsert = upsertMessage;", context);
    return { context, ev, processed, authState, get syncs() { return syncs; } };
}

const protocolMessage = (id, protocol) => ({
    key: { id, remoteJid: "10001@s.whatsapp.net", fromMe: true },
    message: { protocolMessage: protocol },
});

test("disabled passive history sync still processes key shares and ordinary live messages", async () => {
    const h = upsertHarness();
    await h.context.upsert(protocolMessage("history", {
        historySyncNotification: { syncType: 0 },
    }), "notify");
    await h.context.upsert(protocolMessage("key-share", {
        appStateSyncKeyShare: { keys: [] },
    }), "notify");
    await h.context.upsert({
        key: { id: "live", remoteJid: "10001@s.whatsapp.net", fromMe: true },
        message: { conversation: ".ping" },
    }, "notify");
    assert.equal(h.syncs, 0);
    assert.equal(h.processed.length, 3);
    assert.equal(h.processed[0].shouldProcessHistoryMsg, false);
    assert.equal(h.authState.creds.myAppStateKeyId, "new-synthetic-key-id");
    assert.equal(h.ev.isBuffering(), false);
});

test("SDK's default initial account sync remains available when not opted out", async () => {
    const h = upsertHarness({});
    await h.context.upsert(protocolMessage("history", {
        historySyncNotification: { syncType: 0 },
    }), "notify");
    assert.equal(h.syncs, 1);
    assert.equal(h.authState.creds.accountSyncCounter, 1);
});

test("server-sync notifications cannot start passive fetches in bot mode", async () => {
    const source = fs.readFileSync(require.resolve("gifted-baileys/lib/Socket/messages-recv"), "utf8");
    const start = source.indexOf("case 'server_sync':");
    const end = source.indexOf("case 'picture':", start);
    assert.ok(start >= 0 && end > start);
    const calls = [];
    const context = {
        WABinary_1: binary,
        resyncAppState: async (...args) => calls.push(args),
    };
    vm.createContext(context);
    vm.runInContext("this.notify = async (node, config) => { switch(node.attrs.type) {" +
        source.slice(start, end) + "} };", context);
    const node = {
        attrs: { type: "server_sync" },
        content: [{ tag: "collection", attrs: { name: "regular" } }],
    };
    await context.notify(node, { syncAppState: false });
    assert.equal(calls.length, 0);
    await context.notify(node, {});
    assert.equal(calls.length, 1);
});

test("edits, deletions and delivery receipts stay live while account events remain buffered", () => {
    const ev = makeEventBuffer(logger, false);
    const immediate = [];
    const chatEvents = [];
    for (const type of ["messages.update", "messages.delete", "messages.reaction", "message-receipt.update"]) {
        ev.on(type, value => immediate.push({ type, value }));
    }
    ev.on("chats.upsert", value => chatEvents.push(value));
    ev.buffer();
    const key = { remoteJid: "10001@s.whatsapp.net", id: "live-original", fromMe: false };
    ev.emit("messages.update", [{ key, update: { message: {
        editedMessage: { message: { conversation: "example.com" } },
    } } }]);
    ev.emit("messages.delete", { keys: [key] });
    ev.emit("messages.reaction", [{ key, reaction: { text: "👍", key } }]);
    ev.emit("message-receipt.update", [{ key, receipt: { receiptTimestamp: 1 } }]);
    ev.emit("chats.upsert", [{ id: "10001@s.whatsapp.net" }]);
    assert.equal(immediate.length, 4);
    assert.equal(chatEvents.length, 0);
    ev.flush();
    assert.equal(immediate.length, 4);
    assert.equal(chatEvents.length, 1);
});
