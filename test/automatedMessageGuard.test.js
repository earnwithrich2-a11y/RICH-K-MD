const test = require("node:test");
const assert = require("node:assert/strict");
const { installAutomatedMessageGuard } = require("../RICHK-MD-core/connection/automatedMessageGuard");

test("automated IDs are known before native send resolves, without losing send options", async () => {
    let check;
    const quoted = { key: { id: "quote" } };
    const socket = {
        user: { id: "15550000001:7@s.whatsapp.net" },
        async sendMessage(jid, content, options) {
            assert.equal(options.quoted, quoted);
            assert.equal(options.messageId, "explicit-send");
            const sent = { key: { id: options.messageId, fromMe: true, remoteJid: jid }, message: content };
            assert.equal(check(sent), true);
            return sent;
        },
    };
    check = installAutomatedMessageGuard(socket);
    const wrapped = socket.sendMessage;
    assert.equal(installAutomatedMessageGuard(socket), check);
    assert.equal(socket.sendMessage, wrapped);
    await socket.sendMessage("15550000002@s.whatsapp.net", { text: ".ping" }, { messageId: "explicit-send", quoted });
    assert.equal(check({ key: { id: "BAE5-human", fromMe: true } }), false);
    assert.equal(check({ key: { id: "3EB0-human", fromMe: true } }), false);
    assert.equal(check({ key: { id: "explicit-send", fromMe: false } }), false);
    assert.equal(check({ isBaileys: true }), true);
    assert.equal(check({ key: { id: "BAE5-self-command", fromMe: true }, isBaileys: true }), false);
    assert.equal(check({ key: { id: "explicit-send", fromMe: true }, isBaileys: true }), true);
});

test("remembered IDs are bounded and isolated per socket", async () => {
    const makeSocket = () => ({ sendMessage: async (_jid, _content, options) => ({ key: { id: options.messageId } }) });
    const first = makeSocket(), second = makeSocket();
    const check = installAutomatedMessageGuard(first, 2);
    const other = installAutomatedMessageGuard(second, 2);
    for (const messageId of ["one", "two", "three"]) {
        await first.sendMessage("15550000002@s.whatsapp.net", { text: ".ping" }, { messageId });
    }
    assert.equal(check({ key: { fromMe: true, id: "one" } }), false);
    assert.equal(check({ key: { fromMe: true, id: "two" } }), true);
    assert.equal(other({ key: { fromMe: true, id: "two" } }), false);
});
