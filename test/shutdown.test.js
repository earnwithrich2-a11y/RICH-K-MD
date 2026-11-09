const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
const start = source.indexOf("async function shutdownGifted()");
const end = source.indexOf('process.once("SIGINT"', start);

for (const fails of [false, true]) {
    test(`signal shutdown saves login, exits cleanly once and contains cleanup failures (${fails})`, async () => {
        const events = [];
        const socket = {
            prepareForMaintenanceRestart: async () => {
                events.push("save");
                if (fails) throw new Error("save unavailable");
            },
            end: async () => events.push("close"),
            logout: () => assert.fail("Never log out on shutdown"),
        };
        const context = {
            shuttingDown: false, Gifted: socket,
            store: { destroy() { events.push("store"); if (fails) throw new Error("busy"); } },
            process: { exit: code => events.push(`exit:${code}`) },
            setTimeout: () => ({ unref() {} }), clearTimeout() {},
            console: { warn() {} },
        };
        const shutdown = vm.runInNewContext(`(${source.slice(start, end)})`, context);
        await shutdown();
        await shutdown();
        assert.equal(socket.maintenanceRestarting, true);
        assert.deepEqual(events, fails ? ["save", "store", "exit:0"] : ["save", "close", "store", "exit:0"]);
    });
}
