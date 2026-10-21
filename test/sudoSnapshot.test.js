const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("sudo command snapshots avoid disk reads and revocations take effect before setters return", async () => {
    const location = require.resolve("../RICHK-MD-core/database/sudo");
    const rows = new Set(["15550000002"]);
    let syncs = 0, reads = 0;
    const model = {
        sync: async () => { syncs++; },
        findAll: async () => { reads++; return [...rows].map(number => ({ number })); },
        findOrCreate: async ({ where }) => {
            const created = !rows.has(where.number); rows.add(where.number); return [{}, created];
        },
        destroy: async ({ where }) => {
            if (where.number) return rows.delete(where.number) ? 1 : 0;
            const count = rows.size; rows.clear(); return count;
        },
    };
    const original = Module._load;
    let sudo;
    Module._load = function(request, parent, ...rest) {
        if (request === "./database" && parent?.filename === location) return { DATABASE: { define: () => model } };
        return original.call(this, request, parent, ...rest);
    };
    try { sudo = require(location); }
    finally { Module._load = original; }
    await sudo.getSudoNumbers();
    for (let i = 0; i < 20; i++) assert.deepEqual(sudo.getCachedSudoNumbers(), ["15550000002"]);
    assert.equal(reads, 1);
    await sudo.setSudo("15550000003");
    assert.deepEqual(sudo.getCachedSudoNumbers(), ["15550000002", "15550000003"]);
    await sudo.delSudo("15550000002");
    assert.deepEqual(sudo.getCachedSudoNumbers(), ["15550000003"]);
    await sudo.clearAllSudo();
    assert.deepEqual(sudo.getCachedSudoNumbers(), []);
    assert.equal(syncs, 1);
    assert.equal(reads, 1);
});
