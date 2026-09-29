const test = require("node:test");
const assert = require("node:assert/strict");
const {
    findMessageForRetry,
    findMessageForRetryWithWait,
} = require("../RICHK-MD-core/connection/messageRetry");
const { EventEmitter } = require("node:events");
const { SQLiteStore } = require("../RICHK-MD-core/database/messageStore");

const ownJids = ["12345:4@s.whatsapp.net", "998877@lid"];
const ownMessage = {
    key: { fromMe: true, remoteJid: "998877@lid" },
    message: { conversation: "response" },
};

test("uses the exact stored message for a resend", async () => {
    const store = {
        loadMessage: async () => ownMessage,
        loadMessageById: async () => {
            throw new Error("alternate lookup should not run");
        },
    };
    const result = await findMessageForRetry(
        store,
        { id: "one", remoteJid: "12345@s.whatsapp.net", fromMe: true },
        ownJids,
    );
    assert.deepEqual(result, {
        message: ownMessage.message,
        source: "exact",
        isSelfChat: true,
    });
});

test("finds a self-chat resend stored under the alternate LID address", async () => {
    const store = {
        loadMessage: async () => null,
        loadMessageById: async () => ownMessage,
    };
    const result = await findMessageForRetry(
        store,
        { id: "two", remoteJid: "12345@s.whatsapp.net", fromMe: true },
        ownJids,
    );
    assert.deepEqual(result, {
        message: ownMessage.message,
        source: "alternate-self",
        isSelfChat: true,
    });
});

test("does not use another chat's message for a self-chat retry", async () => {
    const store = {
        loadMessage: async () => null,
        loadMessageById: async () => ({
            key: { fromMe: true, remoteJid: "other@s.whatsapp.net" },
            message: { conversation: "private" },
        }),
    };
    const result = await findMessageForRetry(
        store,
        { id: "three", remoteJid: "12345@s.whatsapp.net", fromMe: true },
        ownJids,
    );
    assert.equal(result.message, undefined);
    assert.equal(result.source, "missing");
});

test("does not use alternate lookup for another chat or inbound message", async () => {
    const store = {
        loadMessage: async () => null,
        loadMessageById: async () => {
            throw new Error("alternate lookup should not run");
        },
    };
    for (const key of [
        { id: "four", remoteJid: "other@s.whatsapp.net", fromMe: true },
        { id: "five", remoteJid: "12345@s.whatsapp.net", fromMe: false },
    ]) {
        const result = await findMessageForRetry(store, key, ownJids);
        assert.equal(result.message, undefined);
        assert.equal(result.isSelfChat, false);
    }
});

test("waits briefly for an outgoing self-chat message that is still being saved", async () => {
    let attempts = 0;
    const store = {
        loadMessage: async () => null,
        loadMessageById: async () => (++attempts === 2 ? ownMessage : null),
    };
    const result = await findMessageForRetryWithWait(
        store,
        { id: "late", remoteJid: "12345@s.whatsapp.net", fromMe: true },
        ownJids,
        [0],
    );
    assert.equal(result.message, ownMessage.message);
    assert.equal(result.source, "alternate-self");
    assert.equal(attempts, 2);
});

test("saves outgoing messages before deferring incoming ones and detaches on destroy", async () => {
    const events = new EventEmitter();
    const store = Object.create(SQLiteStore.prototype);
    const saved = [];
    store.saveMessage = (jid, message) => saved.push(message.key.id);
    store.bind(events);
    events.emit("messages.upsert", {
        messages: [
            { key: { id: "out", remoteJid: "12345@s.whatsapp.net", fromMe: true } },
            { key: { id: "in", remoteJid: "other@s.whatsapp.net", fromMe: false } },
        ],
    });
    assert.deepEqual(saved, ["out"]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(saved, ["out", "in"]);
    store.destroy();
    events.emit("messages.upsert", {
        messages: [{ key: { id: "after", remoteJid: "12345@s.whatsapp.net", fromMe: true } }],
    });
    assert.deepEqual(saved, ["out", "in"]);
});