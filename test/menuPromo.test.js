const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { MenuPromo, PROMO_MESSAGE, COOLDOWN_MS } = require("../RICHK-MD-core/connection/menuPromo");
const { installBranding, runCommandOutput, cleanContent, FOOTER } = require("../RICHK-MD-core/branding");

const self = "10001@s.whatsapp.net", peer = "10002@s.whatsapp.net", lid = "20002@lid";
const source = (jid = peer, fromMe = true, alt) => ({
    key: { remoteJid: jid, fromMe, remoteJidAlt: alt, id: "test-command" },
});
function socket() {
    const sent = [];
    return {
        user: { id: "10001:7@s.whatsapp.net", lid: "20001@lid" },
        sent,
        sendMessage: async (...args) => { sent.push(args); return { key: { id: "sent" } }; },
        relayMessage: async (...args) => { sent.push(args); },
    };
}
function promo(t, now = Date.now) {
    const p = new MenuPromo(":memory:", now);
    t.after(() => p.db.close());
    return p;
}

test("exact outgoing menu/settings sends the exact extra promo to the original private peer", async t => {
    const p = promo(t), s = socket();
    installBranding(s);
    await runCommandOutput("menu", { FOOTER }, () => s.sendMessage(peer, { text: "normal menu" }));
    assert.equal(await p.maybeSend(s, "menu", source()), true);
    assert.equal(s.sent.length, 2);
    assert.deepEqual(s.sent.map(args => args[0]), [peer, peer]);
    assert.equal(s.sent[0][1].text, "normal menu");
    assert.equal(s.sent[1][1].text, PROMO_MESSAGE);
});

test("12-hour cooldown is shared by menu/settings and expires at precisely 12 hours", async t => {
    let now = 100000000;
    const p = promo(t, () => now), s = socket();
    assert.equal(await p.maybeSend(s, "settings", source()), true);
    assert.equal(await p.maybeSend(s, "menu", source()), false);
    now += COOLDOWN_MS - 1;
    assert.equal(await p.maybeSend(s, "settings", source()), false);
    now++;
    assert.equal(await p.maybeSend(s, "menu", source()), true);
    assert.equal(s.sent.length, 2);
    assert.equal(await p.maybeSend(s, "menu", source("10003@s.whatsapp.net")), true);
});

test("no incoming, group, channel, self-chat or other command can trigger the promo", async t => {
    const p = promo(t), s = socket();
    for (const command of ["play", "vv", "viewonce", "sticker", "s", "ai", "tiktok", "help", "menus", "botsettings", "boost"]) {
        assert.equal(await p.maybeSend(s, command, source()), false, command);
    }
    for (const message of [
        source(peer, false), source("group@g.us"), source("100@newsletter"),
        source(self), source("20001@lid"), source("20001@lid", true, self),
        { key: { remoteJid: peer } },
    ]) {
        assert.equal(await p.maybeSend(s, "menu", message), false);
        assert.equal(await p.maybeSend(s, "settings", message), false);
    }
    assert.deepEqual(s.sent, []);
});

test("concurrent requests and PN/LID aliases cannot bypass the cooldown", async t => {
    const p = promo(t), s = socket();
    s.signalRepository = { lidMapping: {
        getPNForLID: async jid => jid === lid ? peer : null,
        getLIDForPN: async jid => jid === peer ? lid : null,
    } };
    const results = await Promise.all([
        p.maybeSend(s, "menu", source()),
        p.maybeSend(s, "settings", source(lid, true, peer)),
        p.maybeSend(s, "menu", source(peer, true, lid)),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(s.sent.length, 1);
    assert.equal(await p.maybeSend(s, "menu", source(lid)), false);
});

test("newly learned aliases inherit an existing reservation rather than getting another promo", async t => {
    const p = promo(t), s = socket();
    await p.maybeSend(s, "menu", source());
    await p.maybeSend(s, "settings", source(lid, true, peer));
    assert.equal(await p.maybeSend(s, "menu", source(lid)), false);
    assert.equal(s.sent.length, 1);
});

test("persistent cooldown survives reopening the database", async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "menu-promo-"));
    t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
    const file = path.join(dir, "cooldown.db"), s = socket();
    const p = new MenuPromo(file);
    try { await p.maybeSend(s, "menu", source()); } finally { p.db.close(); }
    const reopened = new MenuPromo(file);
    try { assert.equal(await reopened.maybeSend(s, "settings", source()), false); }
    finally { reopened.db.close(); }
    assert.equal(s.sent.length, 1);
});

test("ambiguous failed sends retain cooldown to prevent repeated inbox messages", async t => {
    const p = promo(t), s = socket();
    let attempts = 0;
    s.sendMessage = async () => { attempts++; throw new Error("network"); };
    assert.equal(await p.maybeSend(s, "menu", source()), false);
    assert.equal(await p.maybeSend(s, "settings", source()), false);
    assert.equal(attempts, 1);
});

test("regular text, media captions and previews are clean without changing results, streams or quoted originals", async () => {
    const s = socket();
    installBranding(s);
    const bytes = Buffer.from("video");
    const quotedMessage = { conversation: `original ${FOOTER}` };
    const media = {
        video: bytes, caption: `Result\n\n> *${FOOTER}*`,
        contextInfo: { mentionedJid: [peer], quotedMessage,
            externalAdReply: { sourceUrl: "https://whatsapp.com/channel/example" },
            forwardedNewsletterMessageInfo: { newsletterJid: "100@newsletter" } },
    };
    await runCommandOutput("tiktok", { FOOTER }, () => s.sendMessage(peer, media));
    const result = s.sent[0][1];
    assert.equal(result.caption, "Result");
    assert.equal(result.video, bytes);
    assert.equal(result.contextInfo.externalAdReply, undefined);
    assert.equal(result.contextInfo.forwardedNewsletterMessageInfo, undefined);
    assert.equal(result.contextInfo.quotedMessage, quotedMessage);
    assert.deepEqual(result.contextInfo.mentionedJid, [peer]);
    assert.equal(media.caption, `Result\n\n> *${FOOTER}*`);
    const stream = Readable.from("audio");
    const content = cleanContent({ audio: { stream }, ptt: true }, {});
    assert.equal(content.audio.stream, stream);
});

test("no clean command creates additional footer/promo messages; concurrent menu context stays isolated", async () => {
    const s = socket();
    installBranding(s);
    await Promise.all([
        runCommandOutput("ai", { FOOTER }, async () => {
            await new Promise(resolve => setImmediate(resolve));
            await s.sendMessage(peer, { text: `Answer\n${FOOTER}` });
        }),
        runCommandOutput("menu", { FOOTER }, () => s.sendMessage(peer, { text: `Menu\n${FOOTER}` })),
        runCommandOutput("sticker", { FOOTER }, () => s.sendMessage(peer, { sticker: Buffer.from("sticker") })),
    ]);
    assert.equal(s.sent.length, 3);
    assert.equal(s.sent.find(args => args[1].text?.includes("Answer"))[1].text, "Answer");
    assert.ok(s.sent.find(args => args[1].text?.includes("Menu"))[1].text.includes(`Menu\n${FOOTER}`));
});

test("direct interactive relays lose promotional footer/buttons and retain functional result links", async () => {
    const s = socket();
    installBranding(s);
    await runCommandOutput("play", {}, () => s.relayMessage(peer, {
        viewOnceMessage: { message: { interactiveMessage: {
            body: { text: "Choose audio" }, footer: { text: FOOTER },
            nativeFlowMessage: { buttons: [
                { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "Channel", url: "https://whatsapp.com/channel/abc" }) },
                { name: "quick_reply", buttonParamsJson: JSON.stringify({ id: "download_audio", display_text: "Audio" }) },
            ] },
        } } },
    }));
    const interactive = s.sent[0][1].viewOnceMessage.message.interactiveMessage;
    assert.equal(interactive.body.text, "Choose audio");
    assert.equal(interactive.footer, undefined);
    assert.equal(interactive.nativeFlowMessage.buttons.length, 1);
    assert.equal(interactive.nativeFlowMessage.buttons[0].name, "quick_reply");
});
