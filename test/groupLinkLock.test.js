const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const vm = require("node:vm");
const {
    getGroupRole, messageText, hasWebLink, enforceGroupLinkLock, isMessageEdit,
} = require("../RICHK-MD-core/groupLinkLock");

const group = "link-lock-test@g.us";
const bot = "10001@s.whatsapp.net";
const member = "10002@s.whatsapp.net";
const admin = "10003@s.whatsapp.net";
const owner = "10004@s.whatsapp.net";
const metadata = {
    ownerPn: owner,
    participants: [
        { id: "20001@lid", pn: bot, admin: "admin" },
        { id: "20002@lid", pn: member, admin: null },
        { id: "20003@lid", pn: admin, admin: "admin" },
        { id: "20004@lid", pn: owner, admin: null },
    ],
};
const message = (sender = member, content = { conversation: "https://example.com" }, from = group) => ({
    key: { remoteJid: from, participant: sender, id: "original-message", fromMe: false },
    message: content,
});
const makeSocket = () => {
    const sent = [];
    return {
        user: { id: "10001:7@s.whatsapp.net", lid: "20001:7@lid" },
        sendMessage: async (...args) => { sent.push(args); },
        sent,
    };
};

test("URL lock detects protocols, bare domains, shortened URLs and caption links, not emails", () => {
    for (const text of ["https://example.com", "HTTP://example.com", "www.example.com",
        "(example.site/path)", "wa.me/123", "bit.ly/abc", "youtu.be/abc",
        "hello:example.space", "https://exam\u200bple.com", "例子.中国"]) {
        assert.equal(hasWebLink(text), true, text);
    }
    for (const text of ["hello everyone", "test@example.com", "version 1.2.3", "20.5", ""]) {
        assert.equal(hasWebLink(text), false, text);
    }
    assert.equal(messageText({ imageMessage: { caption: "example.com" } }), "example.com");
    assert.equal(messageText({ documentWithCaptionMessage: { message: {
        documentMessage: { caption: "example.com" },
    } } }), "example.com");
    assert.equal(messageText({ extendedTextMessage: {
        text: "a harmless reply", contextInfo: { quotedMessage: { conversation: "example.com" } },
    } }), "a harmless reply");
});

test("group roles match PN/LID aliases and device suffixes; empty identities grant nothing", () => {
    assert.equal(getGroupRole(metadata, ["20003:2@lid"]).isAdmin, true);
    assert.equal(getGroupRole(metadata, ["20004@lid"]).isOwner, true);
    assert.equal(getGroupRole(metadata, [member]).isAdmin, false);
    assert.deepEqual(getGroupRole({ participants: [{ admin: "admin" }] }, [""]), {
        isAdmin: false, isOwner: false,
    });
});

test("ordinary members' links are deleted with the original key, without kicking", async () => {
    const socket = makeSocket();
    const msg = message("20002@lid");
    // Global bot-owner/sudo status is intentionally not consulted by this policy.
    socket.isSuperUser = true;
    assert.equal(await enforceGroupLinkLock(socket, msg, async () => metadata), true);
    assert.deepEqual(socket.sent[0], [group, { delete: msg.key }]);
    assert.match(socket.sent[1][1].text, /Only group admins/);
});

test("group admins, superadmins and the group owner can post links silently", async () => {
    for (const sender of [admin, "20003@lid", owner, "20004:1@lid"]) {
        const socket = makeSocket();
        await enforceGroupLinkLock(socket, message(sender), async () => metadata);
        assert.deepEqual(socket.sent, []);
    }
    const superMeta = { participants: [{ id: member, admin: "superadmin" }] };
    assert.equal(getGroupRole(superMeta, [member]).isAdmin, true);
});

test("text without links and private chats are not moderated", async () => {
    const socket = makeSocket();
    await enforceGroupLinkLock(socket, message(member, { conversation: "hello" }), async () => metadata);
    await enforceGroupLinkLock(socket, message(member, { conversation: "example.com" }, member), async () => metadata);
    assert.deepEqual(socket.sent, []);
});

test("wrapped captions and edits cannot bypass the lock", async () => {
    const socket = makeSocket();
    for (const content of [
        { ephemeralMessage: { message: { extendedTextMessage: { text: "example.com" } } } },
        { viewOnceMessageV2: { message: { videoMessage: { caption: "example.com" } } } },
        { editedMessage: { message: { conversation: "example.com" } } },
        { protocolMessage: { editedMessage: { conversation: "example.com" } } },
        { pollCreationMessageV3: { name: "Which?", options: [{ optionName: "example.com" }] } },
        { contactMessage: { vcard: "BEGIN:VCARD\nFN:Test\nURL:https://example.com\nEND:VCARD" } },
        { listMessage: { sections: [{ rows: [{ title: "example.com" }] }] } },
    ]) {
        await enforceGroupLinkLock(socket, message(member, content), async () => metadata);
    }
    assert.equal(socket.sent.filter(([, payload]) => payload.delete).length, 7);
});

test("missing bot admin rights give an explicit warning instead of claiming deletion", async () => {
    const socket = makeSocket();
    const demoted = { ...metadata, participants: metadata.participants.map(p => ({
        ...p, admin: p.pn === bot ? null : p.admin,
    })) };
    assert.equal(await enforceGroupLinkLock(socket, message(), async () => demoted), false);
    assert.match(socket.sent[0][1].text, /needs group-admin rights/);
    assert.equal(socket.sent.some(([, payload]) => payload.delete), false);
});

test("failed deletions do not produce a false success notification", async () => {
    const socket = makeSocket();
    socket.sendMessage = async () => { throw new Error("forbidden"); };
    await assert.rejects(enforceGroupLinkLock(socket, message(), async () => metadata), /forbidden/);
    assert.deepEqual(socket.sent, []);
});

test("a recently demoted admin cannot retain a cached link exemption", async () => {
    const { getGroupMetadata, updateGroupCache, deleteGroupCache } =
        require("../RICHK-MD-core/connection/groupCache");
    const socket = makeSocket();
    let fetched = 0;
    socket.groupMetadata = async () => {
        fetched += 1;
        return { ...metadata, participants: metadata.participants.map(p => ({
            ...p, admin: p.pn === admin ? null : p.admin,
        })) };
    };
    updateGroupCache(group, metadata);
    try {
        await enforceGroupLinkLock(socket, message(admin), getGroupMetadata);
        assert.equal(fetched, 1);
        assert.equal(socket.sent[0][1].delete.id, "original-message");
    } finally {
        deleteGroupCache(group);
    }
});

test("the production anti-link hook prioritizes URL lock and keeps other groups unchanged", async () => {
    const source = fs.readFileSync(require.resolve("../RICHK-MD-core/gmdFunctions2"), "utf8");
    const start = source.indexOf("const GiftedAntiLink = ");
    const end = source.indexOf("\n};", start) + 4;
    const modes = new Map([[group, "true"]]);
    const context = {
        console,
        enforceGroupLinkLock,
        require: (request) => {
            if (request === "./database/groupSettings") return {
                getGroupSetting: async (jid, key) => key === "LOCKURL"
                    ? modes.get(jid) || "false" : "false",
            };
            if (request === "./database/sudo") return {
                getSudoNumbers: async () => { throw new Error("Sudo must not bypass the URL lock"); },
            };
            if (request === "./connection/groupCache") return {};
            throw new Error(`Unexpected dependency: ${request}`);
        },
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end) + "\nthis.antiLink = GiftedAntiLink;", context);
    const socket = makeSocket();
    await context.antiLink(socket, message(), async () => metadata);
    assert.equal(socket.sent.filter(([, payload]) => payload.delete).length, 1);
    socket.sent.length = 0;
    await context.antiLink(socket, message(member, { conversation: "example.com" }, "other@g.us"),
        async () => metadata);
    assert.deepEqual(socket.sent, []);
    modes.set(group, "false");
    await context.antiLink(socket, message(), async () => metadata, true);
    assert.deepEqual(socket.sent, []);
});

const registered = [];
const saved = [];
const pluginPath = require.resolve("../RICHK-MD-commands/linkLock");
const originalLoad = Module._load;
let currentMetadata = metadata;
Module._load = function (request, parent, main) {
    if (parent?.filename === pluginPath) {
        if (request === "../RICHK-MD-core") return {
            gmd: (config, handler) => registered.push({ config, handler }),
            getGroupMetadata: async () => currentMetadata,
        };
        if (request.endsWith("/database/groupSettings")) return {
            setGroupSetting: async (...args) => { saved.push(args); return true; },
        };
    }
    return originalLoad.call(this, request, parent, main);
};
try { require(pluginPath); } finally { Module._load = originalLoad; }
const command = registered.find(({ config }) => config.pattern === "lockurl");

test(".lockurl persists a per-group lock and .lockurl off disables it", async () => {
    saved.length = 0;
    const replies = [];
    const context = { isGroup: true, sender: "20003@lid", reply: async text => replies.push(text) };
    await command.handler(group, makeSocket(), context);
    await command.handler(group, makeSocket(), { ...context, q: "off" });
    assert.deepEqual(saved, [[group, "LOCKURL", "true"], [group, "LOCKURL", "false"]]);
    assert.match(replies[0], /URL lock enabled/);
    assert.match(replies[1], /URL lock disabled/);
});

test(".lockurl rejects ordinary members even with bot-owner/sudo context flags", async () => {
    saved.length = 0;
    const replies = [];
    await command.handler(group, makeSocket(), {
        isGroup: true, sender: member, isSuperUser: true, isSuperAdmin: true,
        reply: async text => replies.push(text),
    });
    assert.deepEqual(saved, []);
    assert.match(replies[0], /Only group admins and the group owner/);
});

test("the group owner may enable the lock even without an admin flag", async () => {
    saved.length = 0;
    await command.handler(group, makeSocket(), {
        isGroup: true, sender: "20004@lid", reply: async () => {},
    });
    assert.deepEqual(saved, [[group, "LOCKURL", "true"]]);
});

test("private chats, invalid modes and a non-admin bot cannot enable the lock", async () => {
    saved.length = 0;
    const replies = [];
    const context = { isGroup: true, sender: admin, reply: async text => replies.push(text) };
    await command.handler(member, makeSocket(), { ...context, isGroup: false });
    await command.handler(group, makeSocket(), { ...context, q: "kick" });
    currentMetadata = { ...metadata, participants: metadata.participants.map(p => ({
        ...p, admin: p.pn === bot ? null : p.admin,
    })) };
    try { await command.handler(group, makeSocket(), context); }
    finally { currentMetadata = metadata; }
    assert.deepEqual(saved, []);
    assert.match(replies.at(-1), /Make the bot a group admin first/);
});

test("live event wiring enforces original edit IDs once and examines every new message", async () => {
    const source = fs.readFileSync(require.resolve("../index"), "utf8");
    const block = source.slice(source.indexOf("function setupChatBotAndAntiLink("),
        source.indexOf("\nfunction ", source.indexOf("function setupChatBotAndAntiLink(") + 1));
    const listeners = {};
    const moderated = [];
    const context = {
        require: () => ({ isMessageEdit }),
        GiftedAntiLink: async (...args) => moderated.push(args),
        getGroupMetadata: async () => metadata,
        getAllSettings: async () => ({ CHATBOT: "false" }),
        GiftedAntibad: async () => {}, GiftedAntiGroupMention: async () => {},
        handleGameMessage: async () => {},
    };
    vm.createContext(context);
    vm.runInContext(block + "\nthis.setup = setupChatBotAndAntiLink;", context);
    const socket = makeSocket();
    socket.ev = { on: (event, handler) => { listeners[event] = handler; } };
    context.setup(socket);
    const edit = message(member, { protocolMessage: {
        key: { id: "original-message" }, editedMessage: { conversation: "example.com" },
    } });
    edit.key.id = "edit-envelope-id";
    await listeners["messages.upsert"]({ type: "notify", messages: [
        edit, message(), message(member, { imageMessage: { caption: "example.com" } }),
    ] });
    assert.equal(moderated.length, 2);
    await listeners["messages.update"]([{
        key: { ...edit.key, id: "original-message" },
        update: { message: { editedMessage: { message: { conversation: "example.com" } } } },
    }]);
    assert.equal(moderated.length, 3);
    assert.equal(moderated[2][1].key.id, "original-message");
    assert.equal(moderated[2][3], true);
});
