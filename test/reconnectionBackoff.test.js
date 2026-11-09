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

test("all non-401 closes reconnect after 15 seconds once, including 500 and duplicate events", async () => {
    for (const code of [400, 403, 408, 409, 428, 440, 500, 503, 515, 599]) {
        let starts = 0;
        const f = harness(async () => { starts++; });
        await f.event({ connection: "open" });
        await f.close(code);
        await f.close(code);
        assert.equal(f.jobs.length, 1);
        assert.equal(f.jobs[0].delay, 15000);
        await f.jobs[0].fn();
        await f.close(code);
        assert.equal(starts, 1);
        assert.equal(f.jobs.length, 1, "retired sockets cannot spawn duplicate instances");
    }
});

test("failed restarts retry every 15 seconds; logout cancels pending retries", async () => {
    const f = harness(async () => { throw new Error("offline"); });
    await f.event({ connection: "open" });
    await f.close(503);
    for (let i = 0; i < 10; i++) await f.jobs[i].fn();
    assert.ok(f.jobs.every(job => job.delay === 15000));
    await f.close(401);
    assert.equal(f.jobs.at(-1).cancelled, true);
    assert.equal(f.socket.authRequired, true);
});

test("401 never schedules a reconnect and maintenance shutdown never starts a competing socket", async () => {
    const loggedOut = harness();
    await loggedOut.close(401);
    assert.equal(loggedOut.jobs.length, 0);
    assert.equal(loggedOut.socket.authRequired, true);
    const maintenance = harness();
    maintenance.socket.maintenanceRestarting = true;
    await maintenance.close(500);
    assert.equal(maintenance.jobs.length, 0);
});
