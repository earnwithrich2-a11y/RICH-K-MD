const test = require("node:test");
const assert = require("node:assert/strict");
const { initAuthCreds } = require("gifted-baileys");
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
    assert.equal(config.syncFullHistory, false);
    assert.equal(config.shouldSyncHistoryMessage(), false);
    assert.equal(config.retryRequestDelayMs, 250);
    assert.equal(config.maxMsgRetryCount, 5);
});