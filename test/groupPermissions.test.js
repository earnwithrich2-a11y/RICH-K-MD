const test = require("node:test");
const assert = require("node:assert/strict");

const { getGroupInfo } = require("../RICHK-MD-core/connection/commandHandler");
const { clearGroupCache, storeLidMapping } = require("../RICHK-MD-core/connection/groupCache");

test("LID-only participant metadata resolves PN sender and bot permissions", async () => {
    const groupJid = "group-permissions-lid-only@g.us";
    const senderLid = "sender-permissions-9001@lid";
    const botLid = "bot-permissions-9002@lid";
    const senderPn = "254700000001@s.whatsapp.net";
    const botPn = "254700000002@s.whatsapp.net";

    clearGroupCache();
    storeLidMapping(senderLid, senderPn);
    storeLidMapping(botLid, botPn);

    const info = await getGroupInfo({
        groupMetadata: async () => ({
            subject: "Permissions",
            participants: [
                { id: senderLid, admin: "admin" },
                { id: botLid, admin: "superadmin" },
            ],
        }),
    }, groupJid, botPn, senderPn);

    assert.equal(info.sender, senderPn);
    assert.equal(info.isAdmin, true);
    assert.equal(info.isSuperAdmin, false);
    assert.equal(info.isBotAdmin, true);
    assert.deepEqual(info.participants, [senderLid, botLid]);
    assert.deepEqual(info.groupAdmins, [senderLid]);
    assert.deepEqual(info.groupSuperAdmins, [botLid]);
});

test("PN participant metadata keeps existing permission behavior", async () => {
    const groupJid = "group-permissions-pn@g.us";
    const senderPn = "254700000003@s.whatsapp.net";
    const botPn = "254700000004@s.whatsapp.net";

    clearGroupCache();
    const info = await getGroupInfo({
        groupMetadata: async () => ({
            subject: "PN permissions",
            participants: [
                { id: senderPn, admin: "admin" },
                { id: botPn, admin: "superadmin" },
            ],
        }),
    }, groupJid, botPn, senderPn);

    assert.equal(info.sender, senderPn);
    assert.equal(info.isAdmin, true);
    assert.equal(info.isSuperAdmin, false);
    assert.equal(info.isBotAdmin, true);
    assert.deepEqual(info.participants, [senderPn, botPn]);
    assert.deepEqual(info.groupAdmins, [senderPn]);
    assert.deepEqual(info.groupSuperAdmins, [botPn]);
});

test("missing or empty JIDs never grant group permissions", async () => {
    const groupJid = "group-permissions-empty-jids@g.us";

    clearGroupCache();
    const info = await getGroupInfo({
        groupMetadata: async () => ({
            participants: [
                { admin: "admin" },
                { id: "", admin: "superadmin" },
            ],
        }),
    }, groupJid, "", "");

    assert.equal(info.isAdmin, false);
    assert.equal(info.isSuperAdmin, false);
    assert.equal(info.isBotAdmin, false);
});