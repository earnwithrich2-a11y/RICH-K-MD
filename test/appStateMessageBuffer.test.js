const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { makeEventBuffer } = require("gifted-baileys/lib/Utils/event-buffer");

function harness(creds = {}, config = {}) {
    const source = fs.readFileSync(require.resolve("gifted-baileys/lib/Socket/chats"), "utf8");
    const declarations = source.slice(source.indexOf("let needToFlushWithAppStateSync"),
        source.indexOf("/** this mutex"));
    const start = source.indexOf("ev.on('connection.update'");
    const connection = source.slice(start, source.indexOf("\n    return {", start));
    const syncStart = source.indexOf("async function doAppStateSync()");
    const syncEnd = source.indexOf("\n    });", syncStart);
    const sync = source.slice(syncStart, syncEnd).replace(/\n    }\s*$/, "");
    const keyStart = source.indexOf("if (config.syncAppState !== false && ((_c = (_b = msg.message)");
    const keyEnd = source.indexOf("\n        async function doAppStateSync()", keyStart);
    const keyShare = source.slice(keyStart, keyEnd);
    assert.ok(declarations.includes("finishAppStateBuffer"));
    const timers = [];
    const warnings = [];
    const logger = { trace() {}, debug() {}, info() {}, warn: text => warnings.push(text) };
    const ev = makeEventBuffer(logger);
    const delivered = [];
    ev.on("messages.upsert", value => delivered.push(...value.messages));
    let syncs = 0;
    const context = {
        ev, config, authState: { creds }, logger, fireInitQueries: false, markOnlineOnConnect: false,
        sendPresenceUpdate: async () => {}, onUnexpectedError() {},
        Types_1: { ALL_WA_PATCH_NAMES: [] },
        resyncAppState: async () => { syncs += 1; },
        setTimeout(callback, ms) {
            const timer = { callback, ms, cancelled: false, unref() {} };
            timers.push(timer);
            return timer;
        },
        clearTimeout(timer) { if (timer) timer.cancelled = true; },
    };
    vm.createContext(context);
    vm.runInContext(declarations + "\n" + sync + "\n" + connection +
        "\nthis.sync = doAppStateSync;" +
        "\nthis.keyShare = async function(msg) { var _b, _c; " + keyShare + " };", context);
    return {
        ev, timers, warnings, delivered, context,
        get syncs() { return syncs; },
        pending() { ev.emit("connection.update", { receivedPendingNotifications: true }); },
        queue() { ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id: "fresh-ping" } }] }); },
    };
}

test("missing app-sync keys cannot indefinitely buffer a fresh command after startup", () => {
    const h = harness();
    h.pending();
    h.queue();
    assert.equal(h.ev.isBuffering(), true);
    assert.equal(h.delivered.length, 0);
    assert.equal(h.timers[0].ms, 30000);
    h.timers[0].callback();
    assert.equal(h.ev.isBuffering(), false);
    assert.equal(h.delivered.length, 1);
    assert.equal(h.warnings.length, 1);
    h.pending(); // A late duplicate notification must not recreate the hold.
    assert.equal(h.ev.isBuffering(), false);
    assert.equal(h.timers.length, 1);
});

test("timeout releases only its owned buffer, not another running operation", () => {
    const h = harness();
    h.pending();
    h.ev.buffer();
    h.queue();
    h.timers[0].callback();
    assert.equal(h.ev.isBuffering(), true);
    assert.equal(h.delivered.length, 0);
    h.timers[0].callback();
    assert.equal(h.ev.isBuffering(), true);
    h.ev.flush();
    assert.equal(h.delivered.length, 1);
});

test("normal sync releases its wait even when the account already synced before", async () => {
    for (const counter of [0, 1]) {
        const h = harness({ accountSyncCounter: counter });
        h.pending();
        h.queue();
        await h.context.sync();
        assert.equal(h.ev.isBuffering(), false);
        assert.equal(h.delivered.length, 1);
        assert.equal(h.syncs, counter === 0 ? 1 : 0);
        assert.equal(h.timers[0].cancelled, true);
        h.timers[0].callback();
        assert.equal(h.warnings.length, 0);
    }
});

test("key shares finish the wait even when history sync never marked it pending", async () => {
    const h = harness({ accountSyncCounter: 1 });
    h.pending();
    h.queue();
    await h.context.keyShare({ message: { protocolMessage: { appStateSyncKeyShare: {} } } });
    assert.equal(h.ev.isBuffering(), false);
    assert.equal(h.delivered.length, 1);
});

test("closing cancels recovery without delivering stale commands", () => {
    const h = harness();
    h.pending();
    h.queue();
    h.ev.emit("connection.update", { connection: "close" });
    assert.equal(h.timers[0].cancelled, true);
    h.timers[0].callback();
    assert.equal(h.delivered.length, 0);
    assert.equal(h.warnings.length, 0);
});

test("an available app-sync key does not create an unnecessary buffer", () => {
    const h = harness({ myAppStateKeyId: "synthetic-test-key-id" });
    h.pending();
    h.queue();
    assert.equal(h.ev.isBuffering(), false);
    assert.equal(h.delivered.length, 1);
    assert.equal(h.timers.length, 0);
});

test("the bot's disabled passive sync never starts an app-key wait or initial resync", async () => {
    const h = harness({}, { syncAppState: false });
    h.pending();
    h.queue();
    await h.context.keyShare({ message: { protocolMessage: { appStateSyncKeyShare: {} } } });
    assert.equal(h.ev.isBuffering(), false);
    assert.equal(h.delivered.length, 1);
    assert.equal(h.syncs, 0);
    assert.equal(h.timers.length, 0);
});
