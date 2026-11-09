const test = require("node:test");
const assert = require("node:assert/strict");
const { initAuthCreds, Browsers } = require("gifted-baileys");
const { createSocketConfig } = require("../RICHK-MD-core/connection/socketConfig");

test("socket initializes WhatsApp state needed to decrypt new messages", () => {
    const config = createSocketConfig(
        [2, 3000, 1],
        {
            creds: initAuthCreds(),
            keys: {
                get: async () => ({}),
                set: async () => {},
            },
        },
        { trace: () => {} },
    );

    assert.equal(config.fireInitQueries, true);
    assert.equal(config.markOnlineOnConnect, false, "online presence must be explicitly enabled");
    assert.equal(config.syncFullHistory, false);
    assert.equal(typeof config.makeSignalRepository, "function", "bungoma crypto writes require the protected repository");
    assert.equal(config.bufferLiveMessages, false);
    assert.equal(config.shouldSyncHistoryMessage(), false);
    assert.equal(config.retryRequestDelayMs, 250);
    assert.equal(config.maxMsgRetryCount, 5);
    assert.deepEqual(config.browser, Browsers.macOS("Desktop"));
});

test("socket getMessage supports store retries without rebroadcasting incoming messages or throwing on store failures", async () => {
    let saved = { key: { fromMe: true }, message: { conversation: "sent reply" } };
    const config = createSocketConfig([2, 3000, 1], {
        creds: initAuthCreds(), keys: { get: async () => ({}), set: async () => {} },
    }, { trace() {} }, { loadMessage: async () => saved });
    const key = { id: "retry", remoteJid: "100@s.whatsapp.net", fromMe: true };
    assert.deepEqual(await config.getMessage(key), saved.message);
    saved = { key: { fromMe: false }, message: { conversation: "private received text" } };
    assert.equal(await config.getMessage(key), undefined);
    const broken = createSocketConfig([2, 3000, 1], {
        creds: initAuthCreds(), keys: { get: async () => ({}), set: async () => {} },
    }, { trace() {} }, { loadMessage: async () => { throw new Error("busy"); } });
    assert.equal(await broken.getMessage(key), undefined);
});