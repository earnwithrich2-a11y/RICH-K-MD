const test = require("node:test");
const assert = require("node:assert/strict");
const { findMessageForRetry, findMessageForRetryWithWait } = require("../RICHK-MD-core/connection/messageRetry");

const own = ["15550000001@s.whatsapp.net"];
function fixture(fromMe) {
    let reads = 0;
    return {
        get reads() { return reads; },
        async loadMessage() {
            reads++;
            return { key: { fromMe }, message: { conversation: "Stored message" } };
        },
        async loadMessageById() { throw new Error("No unrelated alias lookup allowed"); },
    };
}

test("outgoing retries never return other people's cached group or DM messages", async () => {
    for (const remoteJid of ["synthetic-group@g.us", "15550000002@s.whatsapp.net", "99880002@lid"]) {
        for (const originalOwnership of [false, undefined]) {
            const store = fixture(originalOwnership);
            const result = await findMessageForRetryWithWait(store, {
                id: "synthetic-message", remoteJid, fromMe: true,
            }, own, [0, 0]);
            assert.equal(result.source, "not-outgoing");
            assert.equal(result.message, undefined);
            assert.equal(store.reads, 1);
        }
    }
});

test("legitimate outgoing recovery and incoming poll lookups remain available", async () => {
    for (const fromMe of [true, false]) {
        const result = await findMessageForRetry(fixture(fromMe), {
            id: "synthetic-message", remoteJid: "15550000002@s.whatsapp.net", fromMe,
        }, own);
        assert.equal(result.source, "exact");
        assert.equal(result.message.conversation, "Stored message");
    }
});
