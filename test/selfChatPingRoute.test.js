const test = require("node:test");
const assert = require("node:assert/strict");
const { selfChatPingDestination } = require("../RICHK-MD-core/connection/selfChatPingRoute");

const own = {
    user: { id: "123:2@s.whatsapp.net", lid: "789:2@lid" },
    authState: { creds: { me: { lid: "789:2@lid" } } },
};

test("own LID ping replies to the original self-chat address", () => {
    assert.equal(
        selfChatPingDestination(
            "123@s.whatsapp.net",
            { key: { remoteJid: "789:0@lid", fromMe: true } },
            own,
        ),
        "789@lid",
    );
});

test("another person's LID cannot redirect a bot-account ping", () => {
    assert.equal(
        selfChatPingDestination(
            "123@s.whatsapp.net",
            { key: { remoteJid: "456@lid", fromMe: true } },
            own,
        ),
        "123@s.whatsapp.net",
    );
});

test("messages outside the owner's self-chat keep their destination", () => {
    for (const [from, key] of [
        ["456@s.whatsapp.net", { remoteJid: "456@s.whatsapp.net", fromMe: false }],
        ["456@g.us", { remoteJid: "456@g.us", fromMe: true }],
        ["123@s.whatsapp.net", { remoteJid: "123@s.whatsapp.net", fromMe: true }],
    ]) {
        assert.equal(selfChatPingDestination(from, { key }, own), from);
    }
});