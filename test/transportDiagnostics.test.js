const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createTransportLogger } = require("../RICHK-MD-core/connection/transportLogger");
const { trackSelfChatDelivery } = require("../RICHK-MD-core/connection/selfChatDelivery");

test("transport diagnostics allow fixed event names without logging SDK payloads or addresses", () => {
    const logs = [];
    const logger = createTransportLogger(line => logs.push(line));
    logger.debug({ jid: "private-recipient", key: "secret-fixture", ciphertext: "private-cipher" },
        "injected session from retry receipt key bundle");
    logger.child({ private: "child-data" }).error({ trace: "private-stack" }, "error in sending message again");
    logger.warn({ private: "data" }, "unknown arbitrary message");
    logger.trace("injected session from retry receipt key bundle");
    assert.equal(logs.length, 2);
    assert.ok(logs.every(line => !/private|secret|child-data/.test(line)));
    assert.match(logs[0], /Retry session restored/);
    assert.match(logs[1], /Retry resend failed/);
});

test("recipient retry metadata is visible without exposing the recipient or message", () => {
    const logs = [];
    const ws = new EventEmitter();
    const ev = new EventEmitter();
    const dispose = trackSelfChatDelivery({
        ws, ev, user: { id: "15550000001:4@s.whatsapp.net", lid: "99880001:4@lid" },
    }, line => logs.push(line));
    ws.emit("CB:receipt", {
        attrs: { from: "99880002@lid", type: "retry", id: "private-message-id" },
        content: [{ tag: "retry", attrs: { count: "2" } }],
    });
    assert.deepEqual(logs, ["[WhatsApp] DM retry: attempt=2; keyBundle=absent."]);
    ws.emit("CB:receipt", { attrs: { from: "synthetic-group@g.us", type: "retry" } });
    assert.equal(logs.length, 1);
    ev.emit("connection.update", { connection: "close" });
    assert.equal(ws.listenerCount("CB:receipt"), 0);
    dispose();
});
