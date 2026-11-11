const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { Readable } = require("node:stream");
const { mediaContent } = require("../RICHK-MD-core/connection/automationMedia");
const delivery = require("../RICHK-MD-core/connection/viewOnceDelivery");

const ownerModulePath = require.resolve("../RICHK-MD-commands/owner");
const registered = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === ownerModulePath) {
        if (request === "../RICHK-MD-core") return {
            gmd: (metadata, handler) => registered.push({ metadata, handler }),
            commands: [], getSetting: async () => null,
        };
        if (request.endsWith("/viewOnceDownload")) return {
            recoverViewOnce: async () => ({ image: Buffer.from("legacy vv2") }),
        };
        if (request.endsWith("/viewOnceDelivery")) return {
            ...delivery,
            revealQuotedViewOnce: (socket, context) => delivery.revealQuotedViewOnce(socket, context, {
                download: (type, media) => mediaContent(type, media, socket.testDownload),
            }),
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
try { require(ownerModulePath); } finally { Module._load = originalLoad; }
const command = registered.find(({ metadata }) => metadata.pattern === "vv");

async function runReveal({
    key, quoted, sender, isGroup, alias = "vv", isSuperUser = true,
    socketOverrides = {}, contextOverrides = {},
}) {
    const sent = [], downloads = [], replies = [], reactions = [];
    const socket = {
        user: { id: "15550000001:4@s.whatsapp.net" },
        testDownload: async (media, type) => {
            downloads.push({ media, type });
            return Readable.from([Buffer.from("full "), Buffer.from("media")]);
        },
        sendMessage: async (...args) => sent.push(args),
        ...socketOverrides,
    };
    const match = registered.find(({ metadata }) => metadata.pattern === alias || metadata.aliases?.includes(alias));
    assert.ok(match);
    assert.equal(match.metadata.silent, true);
    const result = await match.handler(key.remoteJid, socket, {
        mek: { key }, quoted, sender, isGroup, isSuperUser,
        react: async emoji => reactions.push(emoji),
        reply: async text => replies.push(text),
        ...contextOverrides,
    });
    return { result, sent, downloads, replies, reactions };
}

test("group .vv downloads the direct quote to the connected owner's DM and confirms it in-group", async () => {
    const result = await runReveal({
        key: { remoteJid: "test-group@g.us", participantPn: "15550000002@s.whatsapp.net" },
        quoted: { message: { viewOnceMessageV2: { message: {
            imageMessage: {
                url: "https://example.test/photo", mimetype: "image/jpeg",
                caption: "photo caption", viewOnce: true,
            },
        } } } },
        sender: "15550000002@s.whatsapp.net", isGroup: true,
    });
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0][0], "15550000001@s.whatsapp.net");
    assert.deepEqual(result.sent[0][1].image, Buffer.from("full media"));
    assert.equal(result.sent[0][1].caption, "photo caption");
    assert.equal(result.downloads[0].type, "image");
    assert.equal(result.reactions[0], "⏳");
    assert.equal(result.reactions[1], "✅");
    assert.deepEqual(result.replies, []);
});

test(".vv in a private chat sends media into that chat with its original caption", async () => {
    const result = await runReveal({
        key: { remoteJid: "15550000002@s.whatsapp.net" },
        quoted: { viewOnceMessage: { message: {
            videoMessage: { directPath: "/video", mimetype: "video/mp4", caption: "original caption" },
        } } },
        sender: "15550000002@s.whatsapp.net", isGroup: false,
    });
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0][0], "15550000002@s.whatsapp.net");
    assert.deepEqual(result.sent[0][1].video, Buffer.from("full media"));
    assert.equal(result.sent[0][1].caption, "original caption");
    assert.deepEqual(result.reactions, ["⏳"]);
    assert.deepEqual(result.replies, []);
});

test(".vv accepts modern extension audio and the thumbs-up command alias", async () => {
    const result = await runReveal({
        alias: "👍",
        key: { remoteJid: "15550000002@s.whatsapp.net" },
        quoted: { viewOnceMessageV2Extension: { message: {
            audioMessage: { directPath: "/audio", mimetype: "audio/ogg; codecs=opus", ptt: true },
        } } },
        sender: "15550000002@s.whatsapp.net", isGroup: false,
    });
    assert.equal(result.sent[0][0], "15550000002@s.whatsapp.net");
    assert.deepEqual(result.sent[0][1].audio, Buffer.from("full media"));
    assert.equal(result.sent[0][1].ptt, true);
});

test(".vv explains when the quote is not a view-once message", async () => {
    const result = await runReveal({
        key: { remoteJid: "15550000002@s.whatsapp.net" },
        quoted: { imageMessage: { url: "https://example.test/ordinary", mimetype: "image/jpeg" } },
        sender: "15550000002@s.whatsapp.net", isGroup: false,
    });
    assert.deepEqual(result.reactions, ["⏳"]);
    assert.deepEqual(result.replies, ["⚠️ Please reply to a View-Once photo or video."]);
    assert.equal(result.downloads.length, 0);
    assert.equal(result.sent.length, 0);
});

test(".vv reports expired and 404 downloads with the requested message", async () => {
    for (const error of [
        Object.assign(new Error("HTTP 404"), { statusCode: 404 }),
        new Error("media expired on server"),
    ]) {
        const result = await runReveal({
            key: { remoteJid: "test-group@g.us" },
            quoted: { viewOnceMessageV2: { message: { imageMessage: { directPath: "/expired" } } } },
            sender: "15550000002@s.whatsapp.net", isGroup: true,
            socketOverrides: { testDownload: async () => { throw error; } },
        });
        assert.deepEqual(result.replies, [
            "❌ Could not download this media. It has expired on WhatsApp servers.",
        ]);
        assert.deepEqual(result.reactions, ["⏳"]);
        assert.equal(result.sent.length, 0);
    }
});

test(".vv reports other download and delivery failures instead of failing silently", async () => {
    const failedDownload = await runReveal({
        key: { remoteJid: "15550000002@s.whatsapp.net" },
        quoted: { viewOnceMessageV2: { message: { imageMessage: { directPath: "/photo" } } } },
        sender: "15550000002@s.whatsapp.net", isGroup: false,
        socketOverrides: { testDownload: async () => { throw new Error("network unavailable"); } },
    });
    assert.deepEqual(failedDownload.replies, ["❌ Could not download this media. Please try again."]);

    const failedDelivery = await runReveal({
        key: { remoteJid: "15550000002@s.whatsapp.net" },
        quoted: { viewOnceMessageV2: { message: { imageMessage: { url: "/photo" } } } },
        sender: "15550000002@s.whatsapp.net", isGroup: false,
        socketOverrides: { sendMessage: async () => { throw new Error("delivery failed"); } },
    });
    assert.deepEqual(failedDelivery.replies, ["❌ Could not send the recovered media. Please try again."]);
    assert.deepEqual(failedDelivery.reactions, ["⏳"]);
});

test(".vv remains restricted to the owner and sudo users", async () => {
    const result = await runReveal({
        key: { remoteJid: "15550000002@s.whatsapp.net" },
        quoted: { viewOnceMessageV2: { message: { imageMessage: { directPath: "/photo" } } } },
        sender: "15550000002@s.whatsapp.net", isGroup: false, isSuperUser: false,
    });
    assert.equal(result.downloads.length, 0);
    assert.equal(result.sent.length, 0);
    assert.deepEqual(result.replies, ["⛔ Only the bot owner can use this command."]);
    assert.deepEqual(result.reactions, []);
});
