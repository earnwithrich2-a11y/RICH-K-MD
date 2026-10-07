const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const binary = require("gifted-baileys/lib/WABinary");

function startupHarness(loggedIn = true) {
    const source = fs.readFileSync(require.resolve("gifted-baileys/lib/Socket/socket"), "utf8");
    const start = source.indexOf("let didStartBuffer = false;");
    const end = source.indexOf("// update credentials when required", start);
    assert.ok(start >= 0 && end > start);
    const ev = new EventEmitter();
    const ws = new EventEmitter();
    const timers = [];
    let buffers = 0;
    let flushes = 0;
    let queuedMessage;
    const delivered = [];
    ev.buffer = () => { buffers += 1; };
    ev.flush = () => {
        if (!buffers) return false;
        buffers -= 1;
        flushes += 1;
        if (!buffers && queuedMessage) {
            delivered.push(queuedMessage);
            queuedMessage = undefined;
        }
        return true;
    };
    const warnings = [];
    vm.runInNewContext(source.slice(start, end), {
        ev,
        ws,
        creds: { me: loggedIn ? { id: "synthetic-account" } : undefined },
        WABinary_1: binary,
        process: { nextTick: (callback) => callback() },
        logger: { info() {}, trace() {}, warn: (message) => warnings.push(message) },
        setTimeout(callback, ms) {
            const timer = { callback, ms, cancelled: false, unref() {} };
            timers.push(timer);
            return timer;
        },
        clearTimeout(timer) {
            if (timer) timer.cancelled = true;
        },
    });
    return {
        ev, ws, timers, warnings, delivered,
        get buffers() { return buffers; },
        get flushes() { return flushes; },
        queueMessage(message) { queuedMessage = message; },
        open() { ev.emit("connection.update", { connection: "open" }); },
        offlineDone() {
            ws.emit("CB:ib,,offline", {
                content: [{ tag: "offline", attrs: { count: "0" } }],
            });
        },
    };
}

test("a missing offline-sync marker cannot keep live commands buffered forever", () => {
    const harness = startupHarness();
    assert.equal(harness.buffers, 1);
    harness.open();
    harness.queueMessage(".ping");
    assert.equal(harness.timers[0].ms, 30000);
    harness.timers[0].callback();
    assert.equal(harness.buffers, 0);
    assert.equal(harness.flushes, 1);
    assert.deepEqual(harness.delivered, [".ping"]);
    assert.equal(harness.warnings.length, 1);
    harness.offlineDone();
    assert.equal(harness.flushes, 1, "a late notification must not release another buffer");
});

test("normal sync releases only its own buffer and cancels the fallback", () => {
    const harness = startupHarness();
    harness.open();
    harness.ev.buffer(); // An independent buffered operation is still running.
    harness.offlineDone();
    assert.equal(harness.buffers, 1);
    assert.equal(harness.flushes, 1);
    assert.equal(harness.timers[0].cancelled, true);
    harness.timers[0].callback();
    harness.offlineDone();
    assert.equal(harness.buffers, 1);
    assert.equal(harness.flushes, 1);
    assert.equal(harness.warnings.length, 0);
});

test("closing the socket cancels startup recovery without emitting old messages", () => {
    const harness = startupHarness();
    harness.open();
    harness.queueMessage(".ping");
    harness.ev.emit("connection.update", { connection: "close" });
    assert.equal(harness.timers[0].cancelled, true);
    harness.timers[0].callback();
    harness.offlineDone();
    assert.equal(harness.flushes, 0);
    assert.deepEqual(harness.delivered, []);
});

test("a new unpaired socket does not invent or flush a startup buffer", () => {
    const harness = startupHarness(false);
    harness.open();
    harness.offlineDone();
    assert.equal(harness.buffers, 0);
    assert.equal(harness.flushes, 0);
    assert.equal(harness.timers.length, 0);
});
