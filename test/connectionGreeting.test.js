const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { sendConnectedGreeting } = require("../RICHK-MD-core/connection/connectedGreeting");
const { setupConnectionHandler } = require("../RICHK-MD-core/connection/connectionHandler");

test("connected greeting sends the local logo to the session user's own DM", async () => {
    const sent = [];
    const socket = {
        user: { id: "15550000001:7@s.whatsapp.net" },
        sendMessage: async (jid, content) => sent.push({ jid, content }),
    };

    await sendConnectedGreeting(socket);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, "15550000001@s.whatsapp.net");
    assert.ok(Buffer.isBuffer(sent[0].content.image));
    assert.ok(sent[0].content.image.length > 0);
    assert.equal(sent[0].content.mentions[0], "15550000001@s.whatsapp.net");
    assert.match(sent[0].content.caption, /⚡ \*RICH-K-MD CONNECTED!\* ⚡/);
    assert.match(sent[0].content.caption, /👤 \*Connected User:\* @15550000001/);
    assert.match(sent[0].content.caption, /📌 \*Prefix:\* \./);
    assert.match(sent[0].content.caption, /Type \*\.menu\*/);
    assert.match(sent[0].content.caption, /whatsapp\.com\/channel\/0029VbE9wUJ0Vyc8uRaMNM21/);
    assert.match(sent[0].content.caption, /boosting\.richkaurex\.site/);
});

test("duplicate open updates invoke the greeting callback only once per open state", () => {
    const ev = new EventEmitter();
    let greetings = 0;
    const socket = { ev };
    setupConnectionHandler(socket, "/tmp", () => {}, {
        onOpen: async () => { greetings += 1; },
    });

    ev.emit("connection.update", { connection: "open" });
    ev.emit("connection.update", { connection: "open" });

    assert.equal(greetings, 1);
});
