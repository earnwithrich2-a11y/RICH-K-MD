const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const ownerModulePath = require.resolve("../RICHK-MD-commands/owner");
const registered = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === ownerModulePath && request === "../RICHK-MD-core") {
        return {
            gmd: (metadata, handler) => registered.push({ metadata, handler }),
            commands: [],
            getSetting: async () => null,
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    require(ownerModulePath);
} finally {
    Module._load = originalLoad;
}

const reveal = registered.find(({ metadata }) => metadata.pattern === "vv")?.handler;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "view-once-command-"));
test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

async function runReveal({ key, quoted, sender, isGroup }) {
    const sent = [];
    const downloads = [];
    const replies = [];
    const socket = {
        user: { id: "15550000001:4@s.whatsapp.net" },
        downloadAndSaveMediaMessage: async (media) => {
            downloads.push(media);
            const file = path.join(tempDir, `media-${downloads.length}`);
            fs.writeFileSync(file, "test media");
            return file;
        },
        sendMessage: async (...args) => sent.push(args),
    };
    await reveal(key.remoteJid, socket, {
        mek: { key },
        quoted,
        sender,
        isGroup,
        isSuperUser: true,
        botName: "Test Bot",
        react: async () => {},
        reply: async (message) => replies.push(message),
    });
    return { sent, downloads, replies };
}

test("vv forwards a wrapped view-once image to the requester's DM, not the group", async () => {
    assert.ok(reveal);
    const result = await runReveal({
        key: {
            remoteJid: "test-group@g.us",
            participantPn: "15550000002@s.whatsapp.net",
        },
        quoted: {
            viewOnceMessageV2: {
                message: {
                    imageMessage: { mimetype: "image/jpeg", caption: "photo", viewOnce: true },
                },
            },
        },
        sender: "test-group@g.us",
        isGroup: true,
    });
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0][0], "15550000002@s.whatsapp.net");
    assert.match(result.sent[0][1].caption, /photo/);
    assert.ok(result.sent[0][1].image);
    assert.equal(result.downloads[0].viewOnce, false);
    assert.equal(fs.existsSync(result.sent[0][1].image.url), false);
});

test("vv forwards video used in another person's DM only to the bot account", async () => {
    const result = await runReveal({
        key: { remoteJid: "other@s.whatsapp.net", fromMe: true },
        quoted: {
            viewOnceMessageV2Extension: {
                message: { videoMessage: { mimetype: "video/mp4", viewOnce: true } },
            },
        },
        sender: "15550000001@s.whatsapp.net",
        isGroup: false,
    });
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0][0], "15550000001@s.whatsapp.net");
    assert.ok(result.sent[0][1].video);
    assert.equal(result.downloads[0].viewOnce, false);
});

test("vv does not download or send media when a group requester cannot be identified", async () => {
    const result = await runReveal({
        key: { remoteJid: "test-group@g.us" },
        quoted: { imageMessage: { mimetype: "image/jpeg", viewOnce: true } },
        sender: "test-group@g.us",
        isGroup: true,
    });
    assert.equal(result.sent.length, 0);
    assert.equal(result.downloads.length, 0);
    assert.match(result.replies[0], /No media was sent/);
});