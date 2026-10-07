const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { canShowCurrentChannelJid } = require("../RICHK-MD-core/connection/channelJid");

const pluginPath = require.resolve("../RICHK-MD-commands/owner");
const registered = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === pluginPath && request === "../RICHK-MD-core") {
        return { gmd: (metadata, handler) => registered.push({ metadata, handler }), commands: [] };
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    require(pluginPath);
} finally {
    Module._load = originalLoad;
}
const jidCommand = registered.find(({ metadata }) => metadata.pattern === "jid").handler;

test("the channel exception permits only a bare jid command in a numeric newsletter chat", () => {
    for (const input of [undefined, "", "   "]) {
        assert.equal(canShowCurrentChannelJid("123@newsletter", "jid", input), true);
    }
    for (const [chat, command, input] of [
        ["123@newsletter", "settings", ""],
        ["123@newsletter", "jid", "456"],
        ["123@newsletter", "jid", "https://whatsapp.com/channel/test"],
        ["123@s.whatsapp.net", "jid", ""],
        ["123@g.us", "jid", ""],
        ["invalid@newsletter", "jid", ""],
        [undefined, "jid", ""],
    ]) {
        assert.equal(canShowCurrentChannelJid(chat, command, input), false);
    }
});

async function runCommand(from, q, quotedUser) {
    const messages = [];
    const denials = [];
    await jidCommand(from, {
        sendMessage: async (...args) => messages.push(args),
        newsletterMetadata: () => { throw new Error("No metadata lookup is permitted"); },
    }, {
        q,
        quotedUser,
        isSuperUser: false,
        reply: async (text) => denials.push(text),
        react: async () => {},
    });
    return { messages, denials };
}

test("bare jid displays the actual current channel ID, ignoring quoted personal identities", async () => {
    const result = await runCommand("123@newsletter", "", "456@s.whatsapp.net");
    assert.deepEqual(result.denials, []);
    assert.deepEqual(result.messages, [
        ["123@newsletter", { text: "*Channel JID*\n\n```123@newsletter```" }],
    ]);
});

test("channel lookups with arguments still require owner access", async () => {
    for (const input of ["456", "https://whatsapp.com/channel/test"]) {
        const result = await runCommand("123@newsletter", input);
        assert.deepEqual(result.messages, []);
        assert.deepEqual(result.denials, ["❌ Owner Only Command!"]);
    }
});

test("bare jid in a private chat or group still requires owner access", async () => {
    for (const chat of ["123@s.whatsapp.net", "123@g.us"]) {
        const result = await runCommand(chat, "");
        assert.deepEqual(result.messages, []);
        assert.deepEqual(result.denials, ["❌ Owner Only Command!"]);
    }
});
