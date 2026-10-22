const test = require("node:test");
const assert = require("node:assert/strict");
const { needsGroupMetadata, runWithPresence, premiumText, premiumContent, serviceUnavailable } = require("../RICHK-MD-core/connection/commandRuntime");
const { performancePanel } = require("../RICHK-MD-core/connection/performanceStats");

function loadPlugin(file) {
    const Module = require("node:module");
    const registry = require("../RICHK-MD-core/gmdCmds");
    const original = Module._load;
    Module._load = function(request, parent, ...rest) {
        if (request === "../RICHK-MD-core") {
            return { ...registry, monospace: String, formatBytes: String };
        }
        return original.call(this, request, parent, ...rest);
    };
    try { require(file); }
    finally { Module._load = original; }
    return registry.commands;
}

test("lightweight and AI commands never require a network metadata lookup; group permissions still do", () => {
    for (const pattern of ["ping", "menu", "settings", "alive", "uptime"]) {
        assert.equal(needsGroupMetadata({ pattern }), false);
    }
    assert.equal(needsGroupMetadata({ pattern: "gpt", category: "Ai" }), false);
    assert.equal(needsGroupMetadata({ pattern: "kick", category: "group" }), true);
});

test("typing stays active for overlapping heavy jobs and is cleared even after failure", async () => {
    const states = [];
    const socket = { sendPresenceUpdate: async state => states.push(state) };
    let finish;
    const first = runWithPresence(socket, "chat", { category: "Ai" },
        () => new Promise(resolve => { finish = resolve; }));
    await assert.rejects(runWithPresence(socket, "chat", { heavy: true },
        async () => { throw new Error("offline"); }));
    assert.deepEqual(states, ["composing"]);
    finish();
    await first;
    assert.deepEqual(states, ["composing", "paused"]);
});

test("presence failure is non-fatal and ordinary commands do not emit typing", async () => {
    const socket = { sendPresenceUpdate() { throw new Error("disconnected"); } };
    assert.equal(await runWithPresence(socket, "chat", { heavy: true }, async () => 42), 42);
    assert.equal(await runWithPresence({}, "chat", { pattern: "ping" }, async () => 7), 7);
});

test("live performance shows measured latency, uptime and used RAM rather than a random delay", () => {
    const mb = 1024 * 1024;
    const text = performancePanel(75, {
        now: 100, uptime: 90061, totalMemory: 1024 * mb, freeMemory: 256 * mb, rss: 64 * mb,
    });
    assert.match(text, /25\.00 ms \/ 0\.025 s \(dispatch\)/);
    assert.match(text, /1d 1h 1m/);
    assert.match(text, /768\.0 MB \/ 1024\.0 MB/);
    assert.match(text, /Bot Process RAM: 64\.0 MB/);
    assert.match(text, /👑 Bot Name: RICH-K-MD/);
});

test("command results, captions, machine-readable results and controls remain unwrapped", () => {
    assert.equal(premiumText("hello"), "hello");
    for (const raw of ["https://example.com/file", '{"value":true}', "```js\nx()\n```"]) {
        assert.equal(premiumText(raw), raw);
    }
    for (const control of [{ react: {} }, { delete: {} }, { forward: {} }, { edit: {}, text: "edit" }]) {
        assert.equal(premiumContent(control), control);
    }
    const media = { image: Buffer.from("image"), caption: "A sweet message" };
    assert.equal(premiumContent(media), media);
    assert.equal(premiumContent({ text: "A quote" }).text, "A quote");
    for (const result of [serviceUnavailable(), performancePanel()]) {
        assert.doesNotMatch(result, /╭─ ⚡ RICH-K-MD|╰─────────────────|^─ RICH-K-MD$/m);
    }
});

test("real ping command exposes speed alias, reports live stats and replies in the self-chat", async () => {
    const commands = loadPlugin("../RICHK-MD-commands/general");
    const ping = commands.find(command => command.pattern === "ping");
    assert.ok(ping.aliases.includes("speed"));
    const sent = [];
    const self = "15550000001@s.whatsapp.net";
    await ping.function(self, {
        user: { id: "15550000001:7@s.whatsapp.net" },
        sendMessage: async (jid, content) => { sent.push({ jid, content }); },
    }, {
        mek: { key: { remoteJid: self, fromMe: true } },
        react: async () => {}, botPrefix: ".", dispatchStartedAt: performance.now(),
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, self);
    for (const label of ["Response Speed", "Bot Uptime", "Server RAM Usage", "Bot Name: RICH-K-MD"]) {
        assert.ok(sent[0].content.text.includes(label));
    }
});

test("real AI command replaces provider failure details with a polite service notice", async () => {
    const axios = require("axios");
    const commands = loadPlugin("../RICHK-MD-commands/ai");
    const original = axios.get;
    axios.get = async () => { throw new Error("private-provider-detail"); };
    try {
        const replies = [];
        await commands.find(command => command.pattern === "gpt").function("chat", {}, {
            q: "hello", reply: async text => replies.push(text),
        });
        assert.equal(replies.length, 1);
        assert.match(replies[0], /Service momentarily unavailable/);
        assert.doesNotMatch(replies[0], /private-provider-detail/);
    } finally { axios.get = original; }
});
