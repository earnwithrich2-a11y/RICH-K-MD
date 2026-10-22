const test = require("node:test");
const assert = require("node:assert/strict");
const { Boom } = require("@hapi/boom");
const { EventEmitter } = require("node:events");
const { setupConnectionHandler } = require("../RICHK-MD-core/connection/connectionHandler");

function harness(restart = async () => {}) {
    const jobs = [];
    const socket = { ev: new EventEmitter() };
    setupConnectionHandler(socket, "/unused", restart, {
        schedule(fn, delay) { const job = { fn, delay }; jobs.push(job); return job; },
        cancel(job) { job.cancelled = true; },
    });
    const event = update => socket.ev.listeners("connection.update")[0](update);
    return { socket, jobs, event, close: code => event({ connection: "close", lastDisconnect: { error: new Boom("closed", { statusCode: code }) } }) };
}

test("408, 428, 503 and 515 reconnect once despite duplicate close events", async () => {
    for (const code of [408, 428, 503, 515]) {
        let starts = 0;
        const f = harness(async () => { starts++; });
        await f.event({ connection: "open" });
        await f.close(code);
        await f.close(code);
        assert.equal(f.jobs.length, 1);
        assert.equal(f.jobs[0].delay, 5000);
        await f.jobs[0].fn();
        await f.close(code);
        assert.equal(starts, 1);
        assert.equal(f.jobs.length, 1, "retired sockets cannot spawn duplicate instances");
    }
});

test("failed restarts are caught and retried with bounded backoff; logout cancels pending retries", async () => {
    const f = harness(async () => { throw new Error("offline"); });
    await f.event({ connection: "open" });
    await f.close(503);
    for (let i = 0; i < 10; i++) await f.jobs[i].fn();
    assert.equal(f.jobs[1].delay, 10000);
    assert.ok(f.jobs.every(job => job.delay <= 300000));
    await f.close(401);
    assert.equal(f.jobs.at(-1).cancelled, true);
    assert.equal(f.socket.authRequired, true);
});
