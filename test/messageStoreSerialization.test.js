const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const Database = require("better-sqlite3");

const modulePath = require.resolve("../RICHK-MD-core/database/messageStore");
const originalLoad = Module._load;
let database;
Module._load = function (request, parent, isMain) {
    if (request === "better-sqlite3" && parent?.filename === modulePath) {
        return function InMemoryDatabase() {
            database = new Database(":memory:");
            return database;
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
let store;
try {
    delete require.cache[modulePath];
    store = require(modulePath);
} finally {
    Module._load = originalLoad;
}
test.after(() => database?.close());

test("outgoing messages restore nested Buffer and Uint8Array fields for retries", () => {
    const jid = "test-self@lid";
    const message = {
        key: { id: "bytes-test", remoteJid: jid, fromMe: true },
        message: {
            imageMessage: {
                jpegThumbnail: Buffer.from([1, 2, 3]),
                mediaKey: new Uint8Array([4, 5, 6]),
            },
        },
    };
    store.saveMsg(jid, message);

    const loaded = new store.SQLiteStore().loadMessage(jid, message.key.id);
    assert.equal(Buffer.isBuffer(loaded.message.imageMessage.jpegThumbnail), true);
    assert.equal(Buffer.isBuffer(loaded.message.imageMessage.mediaKey), true);
    assert.deepEqual([...loaded.message.imageMessage.jpegThumbnail], [1, 2, 3]);
    assert.deepEqual([...loaded.message.imageMessage.mediaKey], [4, 5, 6]);
});

test("retry reads messages saved before Node Buffer JSON was handled", () => {
    const jid = "test-self@lid";
    const legacy = {
        key: { id: "legacy-bytes", remoteJid: jid, fromMe: true },
        message: {
            extendedTextMessage: {
                jpegThumbnail: { type: "Buffer", data: [7, 8, 9] },
            },
        },
    };
    database.prepare("INSERT INTO msg_store (jid, id, data) VALUES (?, ?, ?)").run(
        jid,
        legacy.key.id,
        JSON.stringify(legacy),
    );

    const loaded = new store.SQLiteStore().loadMessage(jid, legacy.key.id);
    assert.equal(Buffer.isBuffer(loaded.message.extendedTextMessage.jpegThumbnail), true);
    assert.deepEqual([...loaded.message.extendedTextMessage.jpegThumbnail], [7, 8, 9]);
});