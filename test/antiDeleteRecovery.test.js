const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const Database = require("better-sqlite3");

const projectRoot = path.resolve(__dirname, "..");
const storeModulePath = require.resolve(
    path.join(projectRoot, "RICHK-MD-core/database/messageStore"),
);
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === "better-sqlite3" && parent?.filename === storeModulePath) {
        return function InMemoryDatabase() {
            return new Database(":memory:");
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
let messageStore;
try {
    delete require.cache[storeModulePath];
    messageStore = require(storeModulePath);
} finally {
    Module._load = originalLoad;
}
const {
    saveAntiDelete,
    findAntiDelete,
    removeAntiDelete,
} = messageStore;
const {
    createAntiDeleteRecovery,
} = require(path.join(projectRoot, "RICHK-MD-core/connection/antiDeleteRecovery"));

function storedMessage(id, jid) {
    return {
        key: { id, remoteJid: jid },
        message: { conversation: `text for ${id}` },
        originalSender: "15550001111@s.whatsapp.net",
        originalPushName: "Alice",
    };
}

function makeRecovery(actions) {
    return createAntiDeleteRecovery({
        Gifted: { user: { id: "19990000000:1@s.whatsapp.net" } },
        GiftedAntiDelete: async (...args) => actions.push(args),
        findAntiDelete,
        removeAntiDelete,
        getSender: (message) => message.key.participant || message.key.remoteJid,
        botOwnerJid: "19990000000@s.whatsapp.net",
    });
}

test("recovers a phone-JID message from a LID revoke and removes it afterward", async () => {
    const id = "cross-jid";
    const storedJid = "15550001111@s.whatsapp.net";
    const revokeJid = "987654321@lid";
    const message = storedMessage(id, storedJid);
    saveAntiDelete(storedJid, message);
    const actions = [];
    const recover = makeRecovery(actions);

    let existedDuringRecovery = false;
    const originalAction = actions.push.bind(actions);
    actions.push = (...args) => {
        existedDuringRecovery = Boolean(findAntiDelete(storedJid, id));
        return originalAction(...args);
    };

    await recover(revokeJid, id, {
        id,
        remoteJid: revokeJid,
        participant: message.originalSender,
    });

    assert.equal(actions.length, 1);
    assert.equal(existedDuringRecovery, true);
    assert.equal(actions[0][2].remoteJid, storedJid);
    assert.equal(findAntiDelete(storedJid, id), null);
});

test("continues to recover messages when the revoke uses the exact JID", async () => {
    const id = "exact-jid";
    const jid = "15550002222@s.whatsapp.net";
    const message = storedMessage(id, jid);
    saveAntiDelete(jid, message);
    const actions = [];

    await makeRecovery(actions)(jid, id, {
        id,
        remoteJid: jid,
        participant: message.originalSender,
    });

    assert.equal(actions.length, 1);
    assert.equal(findAntiDelete(jid, id), null);
});

test("runs only one recovery action for duplicate revoke events", async () => {
    const id = "duplicate-revoke";
    const jid = "15550003333@s.whatsapp.net";
    const message = storedMessage(id, jid);
    saveAntiDelete(jid, message);
    const actions = [];
    const recover = makeRecovery(actions);
    const eventKey = {
        id,
        remoteJid: "123456789@lid",
        participant: message.originalSender,
    };

    await Promise.all([
        recover(eventKey.remoteJid, id, eventKey),
        recover(eventKey.remoteJid, id, eventKey),
    ]);

    assert.equal(actions.length, 1);
    assert.equal(findAntiDelete(jid, id), null);
});

test("incoming messages are stored before the delete handler can run", () => {
    const source = fs.readFileSync(path.join(projectRoot, "index.js"), "utf8");
    const capture = source.slice(
        source.indexOf("function setupAntiDelete(Gifted)"),
        source.indexOf("function setupAutoBio(Gifted)"),
    );
    assert.match(capture, /\bsaveAntiDelete\(_jid, _entry\);/);
    assert.doesNotMatch(capture, /setImmediate\(\(\)\s*=>\s*saveAntiDelete/);
});