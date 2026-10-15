const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { attachCommandDiagnostics } = require("../RICHK-MD-core/connection/commandDiagnostics");
const { createTransportLogger } = require("../RICHK-MD-core/connection/transportLogger");

test("transport processing failures expose a safe source location, never error contents", () => {
    const lines = [];
    const err = new TypeError("private-key private-text private-address");
    err.stack = "TypeError: private-key\n at decode (/project/node_modules/sdk/lib/Utils/decode-wa-message.js:42:9)";
    createTransportLogger(line => lines.push(line)).error({ err }, "unexpected error in 'processing offline node'");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /TypeError.*Utils\/decode-wa-message.js:42:9/);
    assert.equal(lines[0].includes("private-"), false);
});

test("diagnostics count stages and queue waits without retaining private packet contents", async () => {
    let time = 100, task = Promise.resolve();
    const socket = {
        ws: new EventEmitter(), ev: new EventEmitter(),
        processingMutex: { mutex(work) { task = task.then(work, work); return task; } },
    };
    const diagnostics = attachCommandDiagnostics(socket, () => time);
    socket.ws.emit("CB:message", { attrs: { from: "private-address" }, secret: "private-key" });
    socket.ev.emit("messages.upsert", {
        messages: [{ key: { fromMe: true }, message: { conversation: "private-text" } }],
    });
    let release;
    const pending = socket.processingMutex.mutex(() => new Promise(resolve => { release = resolve; }));
    await Promise.resolve();
    const next = socket.processingMutex.mutex(async () => "ok");
    time = 150;
    const snapshot = diagnostics.snapshot();
    assert.equal(snapshot.processing.activeForMs, 50);
    assert.equal(snapshot.processing.pending, 1);
    assert.equal(snapshot.counts.messagePackets, 1);
    assert.equal(snapshot.counts.ownMessageEvents, 1);
    assert.equal(JSON.stringify(snapshot).includes("private-"), false);
    release();
    await pending;
    assert.equal(await next, "ok");
    assert.equal(diagnostics.snapshot().processing.pending, 0);
    assert.equal(diagnostics.snapshot().processing.activeForMs, null);
    await assert.rejects(socket.processingMutex.mutex(async () => { throw new Error("expected"); }));
    assert.equal(await socket.processingMutex.mutex(async () => 42), 42);
});
