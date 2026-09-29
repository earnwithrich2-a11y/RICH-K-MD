const test = require("node:test");
const assert = require("node:assert/strict");
const { resolvePrivateRecipient } = require("../RICHK-MD-core/connection/privateRecipient");
const { storeLidMapping } = require("../RICHK-MD-core/connection/groupCache");

test("view-once media stays in the requesting direct chat", async () => {
    const destination = await resolvePrivateRecipient({
        message: {
            key: {
                remoteJid: "self@lid",
                remoteJidAlt: "owner@s.whatsapp.net",
                fromMe: true,
            },
        },
        from: "owner@s.whatsapp.net",
        sender: "owner@s.whatsapp.net",
        isGroup: false,
        socket: { user: { id: "owner:2@s.whatsapp.net" } },
    });
    assert.equal(destination, "self@lid");
});

test("a bot-account command in another person's DM sends media only to its owner", async () => {
    const destination = await resolvePrivateRecipient({
        message: { key: { remoteJid: "other@s.whatsapp.net", fromMe: true } },
        from: "other@s.whatsapp.net",
        sender: "owner@s.whatsapp.net",
        isGroup: false,
        socket: { user: { id: "owner:2@s.whatsapp.net" } },
    });
    assert.equal(destination, "owner@s.whatsapp.net");
});

test("an incoming owner command in a DM returns media to that requester", async () => {
    const destination = await resolvePrivateRecipient({
        message: { key: { remoteJid: "requester@s.whatsapp.net", fromMe: false } },
        from: "requester@s.whatsapp.net",
        sender: "requester@s.whatsapp.net",
        isGroup: false,
        socket: { user: { id: "owner@s.whatsapp.net" } },
    });
    assert.equal(destination, "requester@s.whatsapp.net");
});

test("group view-once media goes to the participant's private phone JID", async () => {
    const destination = await resolvePrivateRecipient({
        message: {
            key: {
                remoteJid: "group@g.us",
                participant: "person@lid",
                participantPn: "15550000001@s.whatsapp.net",
            },
        },
        from: "group@g.us",
        sender: "group@g.us",
        isGroup: true,
        socket: {},
    });
    assert.equal(destination, "15550000001@s.whatsapp.net");
});

test("group view-once media resolves a participant LID to a private chat", async () => {
    storeLidMapping("test-private-recipient@lid", "15550000002@s.whatsapp.net");
    const destination = await resolvePrivateRecipient({
        message: { key: { remoteJid: "group@g.us", participant: "test-private-recipient@lid" } },
        from: "group@g.us",
        sender: "group@g.us",
        isGroup: true,
        socket: {},
    });
    assert.equal(destination, "15550000002@s.whatsapp.net");
});

test("group view-once media never falls back to the group address", async () => {
    const destination = await resolvePrivateRecipient({
        message: { key: { remoteJid: "group@g.us" } },
        from: "group@g.us",
        sender: "group@g.us",
        isGroup: true,
        socket: {},
    });
    assert.equal(destination, null);
});

test("own group invocation delivers privately to the bot account", async () => {
    const destination = await resolvePrivateRecipient({
        message: { key: { remoteJid: "group@g.us", fromMe: true } },
        from: "group@g.us",
        sender: "group@g.us",
        isGroup: true,
        socket: { user: { id: "15550000003:5@s.whatsapp.net" } },
    });
    assert.equal(destination, "15550000003@s.whatsapp.net");
});