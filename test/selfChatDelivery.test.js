const test = require("node:test");
const assert = require("node:assert/strict");
const { serializeMessage, standardizeJid } = require("../RICHK-MD-core/connection/serializer");
const { createHelpers } = require("../RICHK-MD-core/connection/commandHandler");
const { persistOwnOutgoingMessages } = require("../RICHK-MD-core/connection/outgoingMessageStore");
const { findMessageForRetry } = require("../RICHK-MD-core/connection/messageRetry");

const ownPn = "15550000001@s.whatsapp.net";
const ownLid = "99880001@lid";

function socket() {
    const me = { id: "15550000001:4@s.whatsapp.net", lid: "99880001:2@lid" };
    return { user: me, authState: { creds: { me } } };
}

function incoming(remoteJid, options = {}) {
    return {
        key: {
            remoteJid,
            fromMe: options.fromMe ?? true,
            remoteJidAlt: options.remoteJidAlt,
        },
        message: options.message || { conversation: ".ping" },
    };
}

test("device-suffixed own LIDs retain their LID domain", () => {
    assert.equal(standardizeJid("99880001:2@lid"), ownLid);
    assert.equal(standardizeJid("15550000001:4@s.whatsapp.net"), ownPn);
    assert.equal(standardizeJid("12345@g.us"), "12345@g.us");
});

test("an own LID command replies through the authenticated phone JID even without an alternate", async () => {
    const result = await serializeMessage(incoming(ownLid), socket(), { PREFIX: "." });
    assert.equal(result.from, ownPn);
    assert.equal(result.sender, ownPn);
    assert.equal(result.isCommand, true);
});

test("a verified alternate phone JID can identify an own LID chat", async () => {
    const result = await serializeMessage(
        incoming("99880002@lid", { remoteJidAlt: ownPn }),
        socket(),
        { PREFIX: "." },
    );
    assert.equal(result.from, ownPn);
});

test("entry-point metadata alone cannot misidentify another person's LID as the bot's own chat", async () => {
    const result = await serializeMessage(
        incoming("99880003@lid", {
            message: {
                extendedTextMessage: {
                    text: ".ping",
                    contextInfo: { entryPointConversionApp: "whatsapp" },
                },
            },
        }),
        socket(),
        { PREFIX: "." },
    );
    assert.equal(result.from, "99880003@lid");
});

test("a group command retains its group address", async () => {
    const result = await serializeMessage(incoming("12345@g.us"), socket(), { PREFIX: "." });
    assert.equal(result.from, "12345@g.us");
    assert.equal(result.isGroup, true);
});

test("quoted self-chat keys keep the original chat address and recognize the own LID author", async () => {
    const command = incoming(ownLid, {
        message: {
            extendedTextMessage: {
                text: ".del",
                contextInfo: {
                    stanzaId: "quoted-test",
                    participant: "99880001:2@lid",
                    quotedMessage: { conversation: "quoted text" },
                },
            },
        },
    });
    const result = await serializeMessage(command, socket(), { PREFIX: "." });
    assert.equal(result.from, ownPn);
    assert.equal(result.quotedKey.remoteJid, ownLid);
    assert.equal(result.quotedKey.fromMe, true);
    assert.strictEqual(result.ms.key, command.key);
});

test("replies use the own phone chat, while reactions target the unchanged original command key", async () => {
    const command = incoming(ownLid);
    const result = await serializeMessage(command, socket(), { PREFIX: "." });
    const calls = [];
    const helpers = createHelpers(
        {
            sendMessage: (...args) => {
                calls.push(args);
                return Promise.resolve({ key: { id: "sent" } });
            },
        },
        command,
        result.from,
    );

    await helpers.reply("test reply");
    helpers.react("✓");
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], ownPn);
    assert.strictEqual(calls[0][2].quoted, command);
    assert.equal(calls[1][0], ownLid);
    assert.strictEqual(calls[1][1].react.key, command.key);
    assert.equal(command.key.remoteJid, ownLid);
});

test("self-chat sends are available to retry before the delayed own event", async () => {
    const stored = [];
    const liveSocket = {
        ...socket(),
        sendMessage: async (jid, content) => ({
            key: { remoteJid: jid, fromMe: true, id: "test-outgoing" },
            message: content,
        }),
    };
    persistOwnOutgoingMessages(liveSocket, {
        saveMessage: (jid, message) => stored.push({ jid, message }),
    });

    await liveSocket.sendMessage(ownPn, { text: "test reply" });
    assert.equal(stored.length, 1);
    const result = await findMessageForRetry(
        {
            loadMessage: async (jid, id) =>
                stored.find((row) => row.jid === jid && row.message.key.id === id)?.message,
            loadMessageById: async (id) =>
                stored.find((row) => row.message.key.id === id)?.message,
        },
        { remoteJid: ownLid, fromMe: true, id: "test-outgoing" },
        [ownPn, ownLid],
    );
    assert.equal(result.source, "alternate-self");
    assert.deepEqual(result.message, { text: "test reply" });

    await liveSocket.sendMessage("other@s.whatsapp.net", { text: "other chat" });
    assert.equal(stored.length, 1, "other chats keep using the normal event-backed store");
});