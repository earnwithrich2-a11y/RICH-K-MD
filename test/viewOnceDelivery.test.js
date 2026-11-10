const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { saveViewOnceSilently, installViewOnceReactions } = require("../RICHK-MD-core/connection/viewOnceDelivery");
const { ViewOnceCache } = require("../RICHK-MD-core/connection/viewOnceCache");
const { ViewOnceBuffers } = require("../RICHK-MD-core/connection/viewOncePrefetch");
const { attachViewOnceStore } = require("../RICHK-MD-core/connection/viewOnceDownload");

const owner = "100@s.whatsapp.net";
function socket() {
    const sent = [];
    return {
        ev: new EventEmitter(), user: { id: "100:4@s.whatsapp.net", lid: "900@lid" }, sent,
        sendMessage: async (jid, content, options) => {
            sent.push({ jid, content, options });
            return { key: { id: options?.messageId || "sent" } };
        },
    };
}

for (const type of ["image", "video", "audio"]) {
    for (const wrapper of ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"]) {
        test(`${wrapper} ${type}: upsert ID alone resolves a different JID and sends only to the owner`, async t => {
            const s = socket(), cache = new ViewOnceCache({ sweepMs: 0 }), buffers = new ViewOnceBuffers();
            const message = {
                key: { remoteJid: "different-original@lid", id: "photo-id" },
                message: { [wrapper]: { message: { [`${type}Message`]: {
                    mediaKey: Buffer.from("key"), directPath: "/original", mimetype: `${type}/test`,
                    ...(type === "audio" ? { ptt: true } : {}),
                } } } },
            };
            buffers.put(message, { [type]: Buffer.from("decrypted full media") });
            attachViewOnceStore(s, {
                cache, buffers, getSettings: async () => ({ VIEW_ONCE_CACHE: "true" }),
                store: { loadMessage: async () => null }, archive: { find: () => null },
            });
            t.after(() => { s.viewOnceStore.dispose(); cache.destroy(); buffers.destroy(); });
            s.ev.emit("messages.upsert", { type: "notify", messages: [message] });
            assert.equal(cache.byId.get("photo-id").key.id, "photo-id");
            assert.ok(cache.get("photo-id"));
            const result = await saveViewOnceSilently(s, {
                isSuperUser: true, sender: "200@s.whatsapp.net",
                mek: { key: { remoteJid: "unrelated-current@g.us", id: "command" } },
                quotedMessageContext: { stanzaId: "photo-id" },
                reply: () => assert.fail("No chat text"), react: () => assert.fail("No chat reactions"),
            });
            assert.equal(result, true);
            assert.equal(s.sent.length, 1);
            assert.equal(s.sent[0].jid, owner);
            assert.deepEqual(s.sent[0].content[type], Buffer.from("decrypted full media"));
            assert.equal(s.sent[0].content.text, undefined);
            if (type === "audio") assert.equal(s.sent[0].content.ptt, true);
        });
    }
}

for (const wrapper of ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"]) {
    for (const type of ["image", "video", "audio"]) {
        test(`${wrapper} ${type}: arrival starts prefetch before the message is opened`, async t => {
            const s = socket(), cache = new ViewOnceCache({ sweepMs: 0 }), buffers = new ViewOnceBuffers();
            let downloads = 0;
            const id = `arrival-${wrapper}-${type}`;
            const arrived = {
                key: { remoteJid: "source@lid", id },
                message: { [wrapper]: { message: { [`${type}Message`]: {
                    mediaKey: Buffer.from("decryption key"), directPath: "/view-once",
                    mimetype: `${type}/test`, ...(type === "audio" ? { ptt: true } : {}),
                } } } },
            };
            attachViewOnceStore(s, {
                cache, buffers,
                getSettings: async () => ({ VIEW_ONCE_CACHE: "true" }),
                prefetchOptions: { save: async (mediaType, media) => {
                    downloads++;
                    assert.equal(mediaType, `${type}Message`);
                    assert.ok(media.mediaKey, "download starts with the received decryption key");
                    return { [type]: Buffer.from(`cached ${type}`) };
                } },
                store: { loadMessage: async () => null }, archive: { find: () => null },
            });
            t.after(() => { s.viewOnceStore.dispose(); cache.destroy(); buffers.destroy(); });

            // The upsert listener must capture and queue the media before other handlers run.
            s.ev.emit("messages.upsert", { type: "notify", messages: [arrived] });
            arrived.message = { [wrapper]: { message: { [`${type}Message`]: { viewOnce: true } } } };
            const context = {
                isSuperUser: true,
                mek: {
                    key: { id: "reveal-command", remoteJid: "source@g.us" },
                    message: { extendedTextMessage: { contextInfo: {
                        stanzaId: id,
                        quotedMessage: { [wrapper]: { message: { [`${type}Message`]: { viewOnce: true } } } },
                    } } },
                },
            };
            const saved = await saveViewOnceSilently(s, context);
            assert.equal(saved, true);
            assert.equal(downloads, 1);
            assert.equal(s.sent.length, 1);
            assert.equal(s.sent[0].jid, owner);
            assert.deepEqual(s.sent[0].content[type], Buffer.from(`cached ${type}`));
            assert.equal(s.sent[0].content.text, undefined);
        });
    }
}

test("missing owner, unauthorized sender and failed recovery/delivery never call source reply or reaction", async () => {
    for (const mode of ["missing", "unauthorized", "recovery", "delivery"]) {
        const s = socket();
        if (mode === "missing") s.user = {};
        if (mode === "delivery") s.sendMessage = async () => { throw Error("offline"); };
        const context = {
            isSuperUser: mode !== "unauthorized", sender: "200@s.whatsapp.net",
            mek: { key: { remoteJid: "source@g.us", id: "command" } },
            reply: () => assert.fail("No error or success reply"), react: () => assert.fail("No reaction"),
        };
        const result = await saveViewOnceSilently(s, context, {
            recover: async () => {
                if (mode === "recovery") throw Error("No valid media URL or directPath");
                if (mode === "missing" || mode === "unauthorized") assert.fail("Must not read media");
                return { image: Buffer.from("media") };
            },
        });
        assert.equal(result, false);
        assert.deepEqual(s.sent, []);
    }
});

test("missing decryption keys produce the requested status only in the connected owner's DM", async () => {
    const s = socket();
    const err = new Error("no decryption keys");
    err.code = "VIEW_ONCE_KEYS_MISSING";
    const result = await saveViewOnceSilently(s, {
        isSuperUser: true, sender: "200@s.whatsapp.net",
        mek: { key: { remoteJid: "public-source@g.us" } },
        reply: () => assert.fail("The source chat must remain silent"),
        react: () => assert.fail("The source chat must remain silent"),
    }, { recover: async () => { throw err; } });
    assert.equal(result, false);
    assert.deepEqual(s.sent, [{
        jid: owner,
        content: { text: "⚠️ This View-Once arrived before the bot was online, so WhatsApp did not deliver the decryption keys." },
        options: undefined,
    }]);
});

test("other download errors do not send an offline-keys notice to either chat", async () => {
    const s = socket();
    const err = new Error("media service temporarily unavailable");
    err.code = "VIEW_ONCE_DOWNLOAD_FAILED";
    await saveViewOnceSilently(s, {
        isSuperUser: true, mek: { key: { remoteJid: "source@g.us" } },
        reply: () => assert.fail("No public error"),
    }, { recover: async () => { throw err; } });
    assert.deepEqual(s.sent, []);
});

function reaction(id, { fromMe = true, sender = "200@s.whatsapp.net", text = "👍", targetFromMe = false } = {}) {
    return {
        key: { id, remoteJid: "source@g.us", participant: sender, fromMe },
        message: { reactionMessage: {
            text, senderTimestampMs: Date.now(),
            key: { remoteJid: "source@g.us", id: "photo-id", fromMe: targetFromMe },
        } },
    };
}

test("owner thumbs-up is handled from both SDK event shapes once and disappears on socket close", async t => {
    const s = socket(), saved = [];
    const controller = installViewOnceReactions(s, { save: async (_socket, context) => saved.push(context) });
    t.after(controller.destroy);
    const message = reaction("human-reaction");
    s.ev.emit("messages.upsert", { messages: [message] });
    s.ev.emit("messages.reaction", [{
        key: message.message.reactionMessage.key,
        reaction: { ...message.message.reactionMessage, key: message.key },
    }]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].quotedMessageContext.stanzaId, "photo-id");
    assert.deepEqual(s.sent, []);
    s.ev.emit("connection.update", { connection: "close" });
    await controller.handle(reaction("after-close"));
    assert.equal(saved.length, 1);
    assert.equal(s.ev.listenerCount("messages.reaction"), 0);
});

test("a non-owner reacting to an owner's photo cannot impersonate the owner; bot-generated reactions are ignored", async t => {
    const s = socket(), saved = [];
    const controller = installViewOnceReactions(s, { save: async () => saved.push(true) });
    t.after(controller.destroy);
    await controller.handle(reaction("other-person", { fromMe: false, targetFromMe: true }));
    await controller.handle(reaction("removed", { text: "" }));
    const generated = await s.sendMessage("peer@s.whatsapp.net", { react: { text: "👍", key: { id: "photo-id" } } });
    await controller.handle(reaction(generated.key.id));
    assert.deepEqual(saved, []);
    await controller.handle(reaction("verified-owner", { fromMe: false, sender: owner }));
    assert.deepEqual(saved, [true]);
});

test("stale and future thumbs-up history cannot cause an owner-inbox resend storm", async t => {
    const s = socket(), saved = [];
    const controller = installViewOnceReactions(s, { save: async () => saved.push(true) });
    t.after(controller.destroy);
    for (const stamp of [Date.now() - 120000, Date.now() + 120000]) {
        const old = reaction(`history-${stamp}`);
        old.message.reactionMessage.senderTimestampMs = stamp;
        await controller.handle(old);
    }
    const missing = reaction("append-without-time");
    delete missing.message.reactionMessage.senderTimestampMs;
    s.ev.emit("messages.upsert", { type: "append", messages: [missing] });
    assert.deepEqual(saved, []);
    await controller.handle(reaction("fresh-skin-tone", { text: "👍🏿" }));
    assert.deepEqual(saved, [true]);
});

test("enabled presence, read and reaction automation stays silent for View-Once commands", async t => {
    const { installOptionalAutomation } = require("../RICHK-MD-core/connection/optionalAutomation");
    const s = socket(), actions = [];
    s.sendPresenceUpdate = async () => actions.push("presence");
    s.readMessages = async () => actions.push("read");
    s.sendMessage = async () => actions.push("reaction");
    const automation = installOptionalAutomation(s, {
        getSettings: async () => ({
            PREFIX: "$", DM_PRESENCE: "typing", GC_PRESENCE: "typing",
            AUTO_READ_MESSAGES: "all", AUTO_REACT: "all",
        }),
    });
    t.after(automation.destroy);
    for (const [id, text] of [".vv", ".👍", "$vv", "!reveal", ".vv2"].entries()) {
        s.ev.emit("messages.upsert", { type: "notify", messages: [{
            key: { id: `quiet-${id}`, remoteJid: "source@g.us" },
            message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000),
        }] });
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(actions, []);
    s.ev.emit("messages.upsert", { type: "notify", messages: [{
        key: { id: "ordinary", remoteJid: "source@g.us" },
        message: { conversation: "ordinary message" }, messageTimestamp: Math.floor(Date.now() / 1000),
    }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(actions.includes("presence"));
    assert.ok(actions.includes("read"));
    assert.ok(actions.includes("reaction"));
});
