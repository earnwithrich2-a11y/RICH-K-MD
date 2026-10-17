const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const vm = require("node:vm");
const { Sequelize } = require("sequelize");
const {
    LINK_WARNING, enforceSmartAntiLink, configureAntiLink,
} = require("../RICHK-MD-core/smartAntiLink");
const { installBranding } = require("../RICHK-MD-core/branding");

const group = "test-group@g.us";
const bot = "10001@s.whatsapp.net", member = "10002@s.whatsapp.net";
const admin = "10003@s.whatsapp.net", owner = "10004@s.whatsapp.net";
const metadata = {
    participants: [
        { id: "20001@lid", pn: bot, admin: "admin" },
        { id: "20002@lid", pn: member, admin: null },
        { id: "20003@lid", pn: admin, admin: "admin" },
        { id: "20004@lid", pn: owner, admin: null },
    ],
};
const settings = { OWNER_NUMBER: "10004" };
const message = (content = { conversation: "https://example.com" }, sender = member, id = "link-1") => ({
    key: { remoteJid: group, participant: sender, id, fromMe: false }, message: content,
});
function socket() {
    const sent = [];
    return {
        user: { id: "10001:4@s.whatsapp.net", lid: "20001@lid" },
        sent,
        sendMessage: async (...args) => { sent.push(args); return { key: { id: "sent" } }; },
        relayMessage: async () => {},
    };
}
const enforce = (s, msg, meta = metadata) =>
    enforceSmartAntiLink(s, msg, async () => meta, async () => settings);

test("deletes with original key then sends the exact warning privately, without kicking", async () => {
    const s = socket(), msg = message();
    installBranding(s);
    assert.equal(await enforce(s, msg), true);
    assert.deepEqual(s.sent, [[group, { delete: msg.key }, undefined], [member, { text: LINK_WARNING }, undefined]]);
});

test("detects schemes, WhatsApp invites, wa.me, caption links, wrapped messages and reply text", async () => {
    const contents = [
        { conversation: "http://example.com" }, { conversation: "chat.whatsapp.com/Invite" },
        { conversation: "wa.me/10001" }, { conversation: "www.example.com" },
        { imageMessage: { caption: "(example.site/path)" } },
        { videoMessage: { caption: "HTTPS://EXAMPLE.COM" } },
        { extendedTextMessage: { text: "reply: https://example.com", contextInfo: {
            stanzaId: "quoted", quotedMessage: { conversation: "original" },
        } } },
        { ephemeralMessage: { message: { imageMessage: { caption: "https://example.com" } } } },
        { editedMessage: { message: { conversation: "https://example.com" } } },
    ];
    for (const content of contents) {
        const s = socket();
        await enforce(s, message(content));
        assert.equal(s.sent.length, 2, JSON.stringify(content));
        assert.equal(s.sent[1][0], member);
    }
});

test("does not punish harmless replies just because the quoted original had a link", async () => {
    for (const content of [
        { conversation: "hello" }, { conversation: "test@example.com" },
        { extendedTextMessage: { text: "thanks", contextInfo: { quotedMessage: { conversation: "https://example.com" } } } },
    ]) {
        const s = socket();
        assert.equal(await enforce(s, message(content)), false);
        assert.deepEqual(s.sent, []);
    }
});

test("admins and configured bot owner are silently exempt, including LID/device aliases", async () => {
    for (const sender of [admin, "20003@lid", owner, "20004:2@lid"]) {
        const s = socket();
        await enforce(s, message(undefined, sender));
        assert.deepEqual(s.sent, [], sender);
    }
    const s = socket();
    s.isSuperUser = true;
    await enforce(s, message());
    assert.equal(s.sent.length, 2, "sudo/developer flags do not exempt an ordinary member");
});

test("missing bot admin rights, failed permission lookup and delete rejection are quiet", async () => {
    const demoted = { participants: metadata.participants.map(p => p.pn === bot ? { ...p, admin: null } : p) };
    const s = socket();
    assert.equal(await enforce(s, message(), demoted), false);
    assert.deepEqual(s.sent, []);
    assert.equal(await enforceSmartAntiLink(s, message(), async () => { throw new Error("permission"); }, async () => settings), false);
    s.sendMessage = async () => { throw new Error("403"); };
    assert.equal(await enforce(s, message()), false);
    assert.deepEqual(s.sent, [], "never DM that deletion succeeded when it failed");
});

test("failed or stalled DMs do not block moderation or escape as unhandled errors", async () => {
    const s = socket();
    s.sendMessage = async (jid, content) => {
        s.sent.push([jid, content]);
        if (jid === member) throw new Error("DM blocked");
    };
    assert.equal(await enforce(s, message()), true);
    assert.equal(await enforce(s, message(undefined, member, "next")), true);
    assert.equal(s.sent.filter(([, c]) => c.delete).length, 2);
    s.sendMessage = (jid, content) => {
        s.sent.push([jid, content]);
        return jid === member ? new Promise(() => {}) : Promise.resolve();
    };
    assert.equal(await enforce(s, message(undefined, member, "stalled-dm")), true);
});

test("duplicate events delete and privately warn once; no action in a DM", async () => {
    const s = socket(), msg = message();
    await Promise.all([enforce(s, msg), enforce(s, msg)]);
    assert.equal(s.sent.length, 2);
    await enforce(s, { ...msg, key: { ...msg.key, remoteJid: member } });
    assert.equal(s.sent.length, 2);
});

test("command checks real group roles/owner, saves per group, rejects global sudo flags", async () => {
    const s = socket(), saved = [], replies = [];
    const deps = {
        getMetadata: async () => metadata, getSettings: async () => settings,
        save: async (...args) => saved.push(args),
    };
    const run = (sender, q, extra = {}) => configureAntiLink(group, s, {
        isGroup: true, mek: message(undefined, sender), sender, q,
        reply: async text => replies.push(text), ...extra,
    }, deps);
    await run(admin, "on");
    await run(owner, "off");
    assert.deepEqual(saved, [[group, "ANTILINK", "delete"], [group, "ANTILINK", "false"]]);
    await run(member, "on", { isSuperUser: true, isAdmin: true });
    assert.equal(saved.length, 2);
    assert.match(replies.at(-1), /Only group admins and the bot owner/);
    await run(admin, "on", { isGroup: false });
    await run(admin, "__proto__");
    assert.equal(saved.length, 2);
});

test("toggle still saves without bot admin, gives useful guidance, and handles storage errors", async () => {
    const s = socket(), replies = [], saved = [];
    const context = { q: "on", isGroup: true, mek: message(undefined, admin), sender: admin, reply: async text => replies.push(text) };
    const deps = {
        getMetadata: async () => ({ participants: metadata.participants.filter(p => p.pn !== bot) }),
        getSettings: async () => settings, save: async (...args) => saved.push(args),
    };
    await configureAntiLink(group, s, context, deps);
    assert.equal(saved.length, 1);
    assert.match(replies.at(-1), /Make the bot a group admin/);
    deps.save = async () => { throw new Error("disk"); };
    await configureAntiLink(group, s, context, deps);
    assert.match(replies.at(-1), /Could not save/);
});

test("real per-group database settings persist after closing and reopening storage", async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anti-link-settings-"));
    const filename = path.join(dir, "settings.db");
    const groupPath = require.resolve("../RICHK-MD-core/database/groupSettings");
    const load = () => {
        const db = new Sequelize({ dialect: "sqlite", storage: filename, logging: false });
        const original = Module._load;
        Module._load = function (request, parent, main) {
            if (parent?.filename === groupPath && request === "./database") return { DATABASE: db };
            return original.call(this, request, parent, main);
        };
        delete require.cache[groupPath];
        try { return { db, store: require(groupPath) }; }
        finally { Module._load = original; }
    };
    t.after(() => { delete require.cache[groupPath]; fs.rmSync(dir, { recursive: true, force: true }); });
    const first = load();
    try {
        await first.db.sync();
        await first.store.setGroupSetting(group, "ANTILINK", "delete");
        await first.store.setGroupSetting("other@g.us", "ANTILINK", "false");
    } finally { await first.db.close(); }
    const second = load();
    try {
        assert.equal(await second.store.getGroupSetting(group, "ANTILINK"), "delete");
        assert.equal(await second.store.getGroupSetting("other@g.us", "ANTILINK"), "false");
        await second.store.setGroupSetting(group, "ANTILINK", "false");
        assert.equal(await second.store.getGroupSetting(group, "ANTILINK"), "false");
    } finally { await second.db.close(); }
});

test("production hook invokes smart delete mode for new messages and edits but not disabled groups", async () => {
    const source = fs.readFileSync(require.resolve("../RICHK-MD-core/gmdFunctions2"), "utf8");
    const start = source.indexOf("const GiftedAntiLink = ");
    const end = source.indexOf("\n};", start) + 4;
    let mode = "delete";
    const context = {
        console, getAllSettings: async () => settings,
        require: request => {
            if (request === "./database/groupSettings") return {
                getGroupSetting: async (jid, key) => key === "ANTILINK" ? mode : "false",
            };
            if (request === "./database/sudo" || request === "./connection/groupCache") return {};
            if (request === "./smartAntiLink") return { enforceSmartAntiLink };
            throw new Error(request);
        },
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end) + "\nthis.run = GiftedAntiLink;", context);
    const s = socket();
    await context.run(s, message(), async () => metadata);
    await context.run(s, message({ editedMessage: { message: { conversation: "wa.me/123" } } }, member, "edited"), async () => metadata, true);
    assert.equal(s.sent.filter(([, c]) => c.delete).length, 2);
    mode = "false";
    await context.run(s, message(undefined, member, "disabled"), async () => metadata);
    assert.equal(s.sent.length, 4);
});
