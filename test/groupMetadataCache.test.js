const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { groupCache, clearGroupCache, deleteGroupCache, getGroupMetadata, setupGroupCacheListeners } = require("../RICHK-MD-core/connection/groupCache");

test("metadata cache has a five-minute TTL and coalesces concurrent requests", async () => {
    clearGroupCache();
    let calls = 0;
    let finish;
    const metadata = { id: "cache@g.us", participants: [{ id: "owner", admin: "admin" }] };
    const socket = { groupMetadata: () => { calls++; return new Promise(resolve => { finish = resolve; }); } };
    const requests = Array.from({ length: 20 }, () => getGroupMetadata(socket, metadata.id));
    await Promise.resolve();
    assert.equal(calls, 1);
    finish(metadata);
    assert.ok((await Promise.all(requests)).every(value => value === metadata));
    assert.equal(await getGroupMetadata(socket, metadata.id), metadata);
    assert.equal(calls, 1);
    const remaining = groupCache.getTtl(metadata.id) - Date.now();
    assert.ok(remaining > 299000 && remaining <= 300000);
    clearGroupCache();
});

test("metadata invalidation discards stale admin data; a failure has a short retry cooldown", async () => {
    clearGroupCache();
    let finish;
    const socket = { groupMetadata: () => new Promise(resolve => { finish = resolve; }) };
    const stale = getGroupMetadata(socket, "stale@g.us");
    await Promise.resolve();
    deleteGroupCache("stale@g.us");
    finish({ participants: [{ id: "old-admin", admin: "admin" }] });
    assert.equal(await stale, null);
    assert.equal(groupCache.get("stale@g.us"), undefined);
    let calls = 0;
    socket.groupMetadata = async () => { calls++; throw new Error("forbidden"); };
    assert.equal(await getGroupMetadata(socket, "stale@g.us"), null);
    assert.equal(await getGroupMetadata(socket, "stale@g.us"), null);
    assert.equal(calls, 1);
});

test("every group in a group update batch is refreshed", async () => {
    clearGroupCache();
    const ev = new EventEmitter(), calls = [];
    const socket = { ev, groupMetadata: async id => { calls.push(id); return { id, participants: [] }; } };
    setupGroupCacheListeners(socket);
    await ev.listeners("groups.update")[0]([{ id: "one@g.us" }, { id: "two@g.us" }]);
    assert.deepEqual(calls, ["one@g.us", "two@g.us"]);
    assert.ok(groupCache.get("two@g.us"));
    clearGroupCache();
});

test("cache-only command context does not call groupMetadata or invent admin permissions", async () => {
    const { getGroupInfo } = require("../RICHK-MD-core/connection/commandHandler");
    clearGroupCache();
    let calls = 0;
    const socket = { groupMetadata: async () => { calls++; return { participants: [] }; } };
    const info = await getGroupInfo(socket, "fast@g.us", "bot@s.whatsapp.net", "user@s.whatsapp.net", { allowFetch: false });
    assert.equal(calls, 0);
    assert.equal(info.groupInfo, null);
    assert.equal(info.isAdmin, false);
    assert.equal(info.isBotAdmin, false);
});
