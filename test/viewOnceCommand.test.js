const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { Readable } = require("node:stream");
const { recoverViewOnce } = require("../RICHK-MD-core/connection/viewOnceDownload");
const { mediaContent } = require("../RICHK-MD-core/connection/automationMedia");

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
            recoverViewOnce: (socket, context) => recoverViewOnce(socket, context, {
                save: (type, media) => mediaContent(type, media, socket.testDownload),
            }),
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
try { require(ownerModulePath); } finally { Module._load = originalLoad; }
const command = registered.find(({ metadata }) => metadata.pattern === "vv");

async function runReveal({ key, quoted, sender, isGroup, alias = "vv", isSuperUser = true, socketOverrides = {}, contextOverrides = {} }) {
    const sent = [], downloads = [], replies = [];
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
    await match.handler(key.remoteJid, socket, {
        mek: { key }, quoted, sender, isGroup, isSuperUser,
        react: async () => assert.fail("No source-chat reaction is allowed"), reply: async text => replies.push(text),
        ...contextOverrides,
    });
    return { sent, downloads, replies };
}

test("vv silently sends a full image buffer only to the connected owner's DM, never the group requester", async () => {
    const result = await runReveal({
        key: { remoteJid: "test-group@g.us", participantPn: "15550000002@s.whatsapp.net" },
        quoted: { viewOnceMessageV2: { message: {
            imageMessage: { url: "https://example.test/photo", mimetype: "image/jpeg", caption: "photo", viewOnce: true },
        } } },
        sender: "test-group@g.us", isGroup: true,
    });
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0][0], "15550000001@s.whatsapp.net");
    assert.deepEqual(result.replies, []);
    assert.deepEqual(result.sent[0][1].image, Buffer.from("full media"));
    assert.equal(result.sent[0][1].caption, "photo");
    assert.equal(result.downloads[0].media.viewOnce, false);
});

test("vv and thumbs-up contain download, private-send and acknowledgment failures", async () => {
    for (const alias of ["vv", "👍"]) {
        const request = { alias, key: { remoteJid: "15550000002@s.whatsapp.net" },
            sender: "15550000002@s.whatsapp.net",
            quoted: { imageMessage: { url: "https://example.test/photo", viewOnce: true } } };
        const expired = await runReveal({ ...request, socketOverrides: {
            testDownload: async () => { throw new Error("No valid media URL or directPath present in message"); },
        } });
        assert.deepEqual(expired.replies, []);
        assert.equal(expired.sent[0][0], "15550000001@s.whatsapp.net");
        assert.equal(expired.sent[0][1].text,
            "⚠️ This View-Once arrived before the bot was online, so WhatsApp did not deliver the decryption keys.");
        const failedSend = await runReveal({ ...request, socketOverrides: {
            sendMessage: async () => { throw new Error("offline"); },
        } });
        assert.deepEqual(failedSend.replies, []);
        await assert.doesNotReject(runReveal({ ...request, socketOverrides: {
            sendMessage: async () => { throw new Error("offline"); },
        }, contextOverrides: { reply: async () => { throw new Error("offline"); } } }));
        const failedAck = await runReveal({ ...request,
            contextOverrides: { reply: async () => { throw new Error("offline"); } } });
        assert.equal(failedAck.sent.length, 1, "confirmation failures do not resend or leak media");
    }
});

test("thumbs-up alias privately sends a modern extension video buffer to the connected account", async () => {
    const result = await runReveal({
        alias: "👍", key: { remoteJid: "other@s.whatsapp.net", fromMe: true },
        quoted: { viewOnceMessageV2Extension: { message: {
            videoMessage: { directPath: "/video", mimetype: "video/mp4", viewOnce: true },
        } } }, sender: "15550000001@s.whatsapp.net", isGroup: false,
    });
    assert.equal(result.sent[0][0], "15550000001@s.whatsapp.net");
    assert.deepEqual(result.sent[0][1].video, Buffer.from("full media"));
});

test("vv downloads complete view-once audio and preserves voice-note metadata in the requester's inbox", async () => {
    const result = await runReveal({
        key: { remoteJid: "15550000002@s.whatsapp.net" }, sender: "15550000002@s.whatsapp.net",
        quoted: { ephemeralMessage: { message: { viewOnceMessageV2Extension: { message: {
            audioMessage: { url: "https://example.test/audio", mimetype: "audio/ogg; codecs=opus", ptt: true },
        } } } } }, isGroup: false,
    });
    assert.equal(result.sent[0][0], "15550000001@s.whatsapp.net");
    assert.deepEqual(result.sent[0][1].audio, Buffer.from("full media"));
    assert.equal(result.sent[0][1].ptt, true);
    assert.equal(result.sent[0][1].mimetype, "audio/ogg; codecs=opus");
});

test("an unknown group requester identity never changes delivery away from the bot owner's inbox", async () => {
    const result = await runReveal({
        key: { remoteJid: "test-group@g.us" },
        quoted: { imageMessage: { url: "https://example.test/photo", viewOnce: true } },
        sender: "test-group@g.us", isGroup: true,
    });
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0][0], "15550000001@s.whatsapp.net");
    assert.deepEqual(result.replies, []);
});

test("view-once access restrictions are preserved for both aliases", async () => {
    const result = await runReveal({
        alias: "👍", key: { remoteJid: "15550000002@s.whatsapp.net" },
        quoted: { imageMessage: { url: "https://example.test/photo", viewOnce: true } },
        sender: "15550000002@s.whatsapp.net", isSuperUser: false,
    });
    assert.deepEqual(result.replies, []);
    assert.equal(result.sent.length, 0);
    assert.equal(result.downloads.length, 0);
});

test("vv sends only the private missing-keys status when the original is unavailable", async () => {
    const result = await runReveal({
        key: { remoteJid: "15550000002@s.whatsapp.net" },
        quoted: { viewOnceMessageV2: { message: { imageMessage: {} } } },
        sender: "15550000002@s.whatsapp.net",
    });
    assert.equal(result.sent.length, 1);
    assert.equal(result.sent[0][0], "15550000001@s.whatsapp.net");
    assert.equal(result.sent[0][1].text,
        "⚠️ This View-Once arrived before the bot was online, so WhatsApp did not deliver the decryption keys.");
    assert.deepEqual(result.replies, []);
});

test("every reveal alias remains silent when used without a recoverable original", async () => {
    for (const alias of ["vv", "👍", "vv2", "reveal", "reveal2"]) {
        const result = await runReveal({
            alias, key: { remoteJid: "source@g.us", participant: "200@s.whatsapp.net" },
            quoted: { imageMessage: { viewOnce: true } }, sender: "200@s.whatsapp.net", isGroup: true,
        });
        assert.equal(result.sent.length, 1);
        assert.equal(result.sent[0][0], "15550000001@s.whatsapp.net");
        assert.equal(result.sent[0][1].text,
            "⚠️ This View-Once arrived before the bot was online, so WhatsApp did not deliver the decryption keys.");
        assert.deepEqual(result.replies, []);
    }
});
