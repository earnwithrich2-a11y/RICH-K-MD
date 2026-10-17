const test = require("node:test");
const assert = require("node:assert/strict");
const { FOOTER, brandProto, installBranding } = require("../RICHK-MD-core/branding");
const { EventEmitter } = require("events");
const { restartDelay, supervise } = require("../scripts/run-bot");

test("brands text, caption and forward copies once without modifying cached original", async () => {
    const sends = [], relays = [];
    const socket = {
        sendMessage: async (jid, content) => { sends.push(content); return { key: { id: "sent" } }; },
        relayMessage: async (jid, message) => relays.push(message),
    };
    installBranding(socket);
    const source = { message: { conversation: "original" } };
    await socket.sendMessage("chat", { text: "hello" });
    await socket.sendMessage("chat", { text: `hello\n${FOOTER}` });
    await socket.sendMessage("chat", { image: Buffer.from("image"), caption: "caption" });
    await socket.sendMessage("chat", { forward: source });
    await socket.relayMessage("chat", {
        viewOnceMessage: { message: { interactiveMessage: { body: { text: "menu" } } } },
    });
    for (const item of [sends[0].text, sends[1].text, sends[2].caption, sends[3].forward.message.conversation]) {
        assert.equal(item.split(FOOTER).length - 1, 1);
    }
    assert.equal(source.message.conversation, "original");
    assert.equal(relays[0].viewOnceMessage.message.interactiveMessage.footer.text, FOOTER);
});

test("captionless audio and stickers get companion footer; reactions and deletes stay untouched", async () => {
    const sent = [];
    const socket = {
        sendMessage: async (jid, content) => { sent.push(content); return { key: { id: "sent" } }; },
        relayMessage: async () => {},
    };
    installBranding(socket);
    await socket.sendMessage("chat", { audio: Buffer.from("audio"), ptt: true });
    await socket.sendMessage("chat", { sticker: Buffer.from("sticker") });
    const react = { react: { text: "👍", key: {} } }, deletion = { delete: { id: "id" } };
    await socket.sendMessage("chat", react);
    await socket.sendMessage("chat", deletion);
    assert.equal(sent[1].text, FOOTER);
    assert.equal(sent[3].text, FOOTER);
    assert.equal(sent[4], react);
    assert.equal(sent[5], deletion);
    assert.deepEqual(brandProto({ protocolMessage: { type: 0 } }).message, { protocolMessage: { type: 0 } });
});

test("promotion commands and aliases send instructions to any caller without claiming live balances", async () => {
    const { commands } = require("../RICHK-MD-core/gmdCmds");
    require("../RICHK-MD-commands/promotion");
    for (const [pattern, alias] of [["boost", "services"], ["sms", "otp"], ["deposit", "balance"]]) {
        const command = commands.find(c => c.pattern === pattern);
        assert.ok(command.aliases.includes(alias));
        assert.equal(command.category, "general");
        const sent = [];
        await command.function("public-user", { sendMessage: async (...args) => sent.push(args) }, { isSuperUser: false });
        assert.equal(sent[0][0], "public-user");
        assert.match(sent[0][1].text, /https:\/\/boosting.richkaurex.site/);
        if (pattern === "deposit") assert.match(sent[0][1].text, /does not access your balance/);
    }
});

test("supervisor backs off crashes and forwards shutdown without restarting", () => {
    const children = [], scheduled = [], exits = [];
    const controller = supervise({
        spawnChild: () => {
            const child = new EventEmitter();
            child.kill = signal => { child.signal = signal; };
            children.push(child);
            return child;
        },
        schedule: (fn, delay) => { scheduled.push({ fn, delay }); },
        exit: code => exits.push(code),
    });
    children[0].emit("exit", 1);
    assert.equal(scheduled[0].delay, 1000);
    scheduled[0].fn();
    children[1].emit("exit", 1);
    assert.equal(scheduled[1].delay, 2000);
    scheduled[1].fn();
    controller.stop();
    assert.equal(children[2].signal, "SIGTERM");
    children[2].emit("exit", 0);
    assert.deepEqual(exits, [0]);
    assert.equal(scheduled.length, 2);
    assert.equal(restartDelay(100), 60000);
});
