const test = require("node:test");
const assert = require("node:assert/strict");
const {
    selfChatDestination,
    prepareSelfChatRecipients,
} = require("../RICHK-MD-core/connection/selfChatTransport");
const { persistOwnOutgoingMessages } = require("../RICHK-MD-core/connection/outgoingMessageStore");

const me = { id: "123:2@s.whatsapp.net", lid: "789:2@lid" };

test("self-chat uses one LID route without redirecting unrelated chats", () => {
    assert.equal(selfChatDestination("123@s.whatsapp.net", me), "789@lid");
    assert.equal(selfChatDestination("789@lid", me), "789@lid");
    assert.equal(selfChatDestination("456@s.whatsapp.net", me), "456@s.whatsapp.net");
    assert.equal(selfChatDestination("456@g.us", me), "456@g.us");
    assert.equal(selfChatDestination("123@s.whatsapp.net", { id: me.id }), "123@s.whatsapp.net");
});

test("self-chat encryption excludes the sender and duplicate PN/LID device aliases", () => {
    const message = {
        deviceSentMessage: {
            destinationJid: "789@lid",
            message: { conversation: "synthetic self-chat test" },
        },
    };
    const patched = prepareSelfChatRecipients(message, [
        "789@lid",
        "123:2@s.whatsapp.net",
        "789:2@lid",
        "123:3@s.whatsapp.net",
        "789:3@lid",
        "789:3@lid",
    ], me);
    assert.deepEqual(patched.map((item) => item.recipientJid), ["789@lid", "789:3@lid"]);
    for (const item of patched) assert.deepEqual(item.deviceSentMessage, message.deviceSentMessage);
    assert.equal(Object.hasOwn(message, "recipientJid"), false, "source message is unchanged");
});

test("ordinary chats and their own-device copies are untouched", () => {
    const message = {
        deviceSentMessage: { destinationJid: "456@s.whatsapp.net", message: { conversation: "other" } },
    };
    assert.equal(prepareSelfChatRecipients(message, ["123:2@s.whatsapp.net"], me), message);
    const direct = { conversation: "direct" };
    assert.equal(prepareSelfChatRecipients(direct, ["789@lid"], me), direct);
});

test("a sender-only retry cannot generate an empty encrypted stanza", () => {
    assert.throws(() => prepareSelfChatRecipients({
        deviceSentMessage: { destinationJid: "789@lid", message: {} },
    }, ["789:2@lid"], me), /sending device/);
});

test("self-chat refreshes device discovery, preserves options and stores the routed send", async () => {
    const calls = [];
    const saved = [];
    const cleared = [];
    const socket = {
        user: me,
        sendMessage: async (...args) => {
            calls.push(args);
            return { key: { remoteJid: args[0], fromMe: true, id: "synthetic" }, message: args[1] };
        },
    };
    persistOwnOutgoingMessages(
        socket,
        { saveMessage: (...args) => saved.push(args) },
        { del: (keys) => cleared.push(keys) },
    );
    const quoted = { key: { id: "quoted" } };
    await socket.sendMessage("123@s.whatsapp.net", { text: "hello" }, { quoted });
    assert.equal(calls[0][0], "789@lid");
    assert.deepEqual(calls[0][2], { quoted });
    assert.deepEqual(cleared, [["123", "789"]]);
    assert.equal(saved[0][0], "789@lid");

    await socket.sendMessage("456@s.whatsapp.net", { text: "other" });
    assert.equal(calls[1].length, 2);
    assert.equal(calls[1][0], "456@s.whatsapp.net");
    assert.equal(saved.length, 2, "direct messages are saved immediately for retry recovery");
    assert.equal(saved[1][0], "456@s.whatsapp.net");
    assert.equal(cleared.length, 1, "other chats do not invalidate device discovery");
});
