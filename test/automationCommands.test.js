const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { isMaintenanceOwner, DENIED } = require("../RICHK-MD-core/connection/maintenance");
const plugin = require.resolve("../RICHK-MD-commands/automation");
const registered = [];
const values = {}, writes = [], sent = [], presence = [];
let metadata = { participants: [] }, downloadError = false;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === plugin) {
        if (request.endsWith("/gmdCmds")) return { gmd: (spec, handler) => registered.push({ ...spec, handler }) };
        if (request.endsWith("/database/settings")) return {
            getAllSettings: async () => values,
            setSetting: async (key, value) => { values[key] = value; writes.push([key, value]); },
        };
        if (request.endsWith("/database/groupSettings")) return { setGroupSetting: async (...args) => writes.push(args) };
        if (request.endsWith("/connection/groupCache")) return { getGroupMetadata: async () => metadata };
        if (request.endsWith("/connection/maintenance")) return { isMaintenanceOwner, DENIED };
        if (request.endsWith("/connection/automationMedia")) return {
            mediaContent: async type => {
                if (downloadError) throw new Error("expired");
                return { [type.replace("Message", "")]: Buffer.from("media") };
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
try { require(plugin); } finally { Module._load = originalLoad; }

async function run(pattern, q, overrides = {}) {
    const replies = [];
    const socket = {
        user: { id: "300:4@s.whatsapp.net" },
        sendMessage: async (...args) => sent.push(args),
        sendPresenceUpdate: async (...args) => presence.push(args),
    };
    await registered.find(cmd => cmd.pattern === pattern).handler("123@g.us", socket, {
        q, sender: "300@s.whatsapp.net", mek: { key: { fromMe: true } },
        reply: async text => replies.push(text), ...overrides,
    });
    return replies;
}

test.beforeEach(() => {
    for (const key of Object.keys(values)) delete values[key];
    writes.length = 0; sent.length = 0; presence.length = 0; downloadError = false;
});

test("new commands register once without duplicating existing download, AI or status controls", () => {
    assert.deepEqual(registered.map(cmd => cmd.pattern),
        ["faketyping", "fakerecording", "alwaysonline", "antiviewonce", "antikick", "savestatus"]);
    assert.ok(registered.find(cmd => cmd.pattern === "savestatus").aliases.includes("statusdl"));
});

for (const pattern of ["faketyping", "fakerecording", "alwaysonline", "antiviewonce", "savestatus"]) {
    test(`${pattern} rejects non-owners even when a broad superuser flag is supplied`, async () => {
        const replies = await run(pattern, "on", {
            sender: "999@s.whatsapp.net", ownerNumber: "400", isSuperUser: true, mek: { key: { fromMe: false } },
        });
        assert.equal(replies[0], DENIED);
        assert.equal(writes.length, 0);
        assert.equal(sent.length, 0);
    });
}

test("fake typing/recording share existing presence modes and do not disable the other mode accidentally", async () => {
    await run("faketyping", "on");
    assert.equal(values.DM_PRESENCE, "typing");
    assert.equal(values.GC_PRESENCE, "typing");
    await run("fakerecording", "on");
    assert.equal(values.DM_PRESENCE, "recording");
    await run("faketyping", "off");
    assert.equal(values.DM_PRESENCE, "recording");
    await run("fakerecording", "off");
    assert.equal(values.GC_PRESENCE, "offline");
});

test("always-online and automatic view-once have strict on/off settings and retain no dependency on recovery settings", async () => {
    await run("alwaysonline", "on");
    await run("antiviewonce", "on");
    assert.equal(values.ALWAYS_ONLINE, "true");
    assert.equal(values.ANTIVIEWONCE, "indm");
    await run("antiviewonce", "off");
    assert.equal(values.ANTIVIEWONCE, "off");
    const before = writes.length;
    assert.match((await run("alwaysonline", "invalid"))[0], /Usage/);
    assert.equal(writes.length, before);
    assert.ok(writes.every(([key]) => !["ANTIDELETE", "ANTI_EDIT", "LOCKURL", "ANTILINK"].includes(key)));
});

test("anti-kick toggles are group-admin only, persist per group, and require bot admin rights", async () => {
    assert.match((await run("antikick", "on"))[0], /only works in groups/);
    metadata = { participants: [{ id: "300@s.whatsapp.net", admin: "admin" }] };
    await run("antikick", "on", { isGroup: true });
    assert.deepEqual(writes[0], ["123@g.us", "ANTIKICK", "true"]);
    writes.length = 0;
    assert.match((await run("antikick", "off", {
        isGroup: true, sender: "999@s.whatsapp.net", mek: { key: { fromMe: false } },
    }))[0], /Only group admins/);
    assert.equal(writes.length, 0);
    metadata = { owner: "100@s.whatsapp.net", participants: [] };
    assert.match((await run("antikick", "on", {
        isGroup: true, sender: "100@s.whatsapp.net", mek: { key: { fromMe: false, participant: "100@s.whatsapp.net" } },
    }))[0], /Make the bot a group admin/);
});

for (const type of ["image", "video", "audio"]) {
    test(`savestatus downloads quoted ${type} media into the connected account's inbox`, async () => {
        await run("savestatus", "", { mek: {
            key: { fromMe: true }, message: { extendedTextMessage: { contextInfo: {
                remoteJid: "status@broadcast", quotedMessage: { [`${type}Message`]: {} },
            } } },
        } });
        assert.equal(sent.length, 1);
        assert.equal(sent[0][0], "300@s.whatsapp.net");
        assert.ok(Buffer.isBuffer(sent[0][1][type]));
    });
}

test("savestatus supports text and fails clearly for missing or expired status media", async () => {
    assert.match((await run("savestatus", ""))[0], /Reply to a status/);
    const quote = content => ({ mek: { key: { fromMe: true },
        message: { extendedTextMessage: { contextInfo: { quotedMessage: content } } } } });
    await run("savestatus", "", quote({ extendedTextMessage: { text: "status text" } }));
    assert.deepEqual(sent[0], ["300@s.whatsapp.net", { text: "status text" }]);
    downloadError = true;
    assert.match((await run("savestatus", "", quote({ imageMessage: {} })))[0], /expired/);
});
