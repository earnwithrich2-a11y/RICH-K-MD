const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const utils = require("gifted-baileys/lib/Utils");
const binary = require("gifted-baileys/lib/WABinary");
const { makeLibSignalRepository } = require("gifted-baileys/lib/Signal/libsignal");
const { trackSelfChatDelivery } = require("../RICHK-MD-core/connection/selfChatDelivery");

// Synthetic credentials only: these tests never load the bot's login.
function memoryAuth() {
    const data = {};
    return {
        creds: utils.initAuthCreds(),
        keys: {
            async get(type, ids) {
                return Object.fromEntries(ids.map((id) => [id, data[type]?.[id]]));
            },
            async set(update) {
                for (const [type, values] of Object.entries(update)) {
                    data[type] = { ...data[type], ...values };
                }
            },
        },
    };
}

function receipt(auth = memoryAuth(), preKey = utils.Curve.generateKeyPair()) {
    return {
        tag: "receipt",
        attrs: { type: "retry" },
        content: [
            { tag: "registration", attrs: {}, content: utils.encodeBigEndian(auth.creds.registrationId) },
            {
                tag: "keys",
                attrs: {},
                content: [
                    { tag: "type", attrs: {}, content: Buffer.from([5]) },
                    { tag: "identity", attrs: {}, content: auth.creds.signedIdentityKey.public },
                    utils.xmppSignedPreKey(auth.creds.signedPreKey),
                    utils.xmppPreKey(preKey, 41),
                ],
            },
        ],
    };
}

const receiveSource = fs.readFileSync(
    require.resolve("gifted-baileys/lib/Socket/messages-recv"), "utf8",
);

function retryHarness(rejectBundle = false, messageAvailable = true) {
    // Exercise the installed resender, not a separate approximation.
    const start = receiveSource.indexOf("const sendMessagesAgain =");
    const end = receiveSource.indexOf("const handleReceipt =", start);
    assert.ok(start >= 0 && end > start);
    const calls = [];
    const missingAttempts = [];
    const resend = vm.runInNewContext(
        `(() => { ${receiveSource.slice(start, end)} return sendMessagesAgain; })()`,
        {
            Utils_1: utils,
            WABinary_1: binary,
            getMessage: async () => messageAvailable ? ({ conversation: "Synthetic recovered message" }) : undefined,
            assertSessions: async (...args) => calls.push(["server", ...args]),
            signalRepository: {
                async injectE2ESession(value) {
                    calls.push(["bundle", value]);
                    if (rejectBundle) throw new Error("Synthetic rejected signature");
                },
            },
            authState: { keys: { set: async () => {} } },
            logger: { debug() {}, warn() {} },
            updateSendMessageAgainCount(id, participant) { missingAttempts.push({ id, participant }); },
            relayMessage: async (...args) => calls.push(["relay", ...args]),
        },
    );
    return { calls, resend, missingAttempts };
}

const retryKey = {
    remoteJid: "19999999999@lid",
    participant: "19999999999:3@lid",
};
const retryNode = { tag: "retry", attrs: { count: "2" } };

test("missing retry payloads do not reset sessions, inject bundles or relay anything", async () => {
    const { calls, resend, missingAttempts } = retryHarness(false, false);
    await resend(retryKey, ["missing-one", "missing-two"], retryNode, receipt());
    assert.deepEqual(calls, []);
    assert.deepEqual(missingAttempts.map(entry => entry.id), ["missing-one", "missing-two"]);
    assert.ok(missingAttempts.every(entry => entry.participant === retryKey.participant));
});

test("retry bundles validate required lengths and support optional one-time keys", () => {
    const valid = receipt();
    const parsed = utils.extractE2ESessionFromRetryReceipt(valid);
    assert.equal(parsed.preKey.keyId, 41);
    assert.equal(parsed.identityKey.length, 33);
    assert.equal(parsed.signedPreKey.signature.length, 64);
    assert.equal(utils.extractE2ESessionFromRetryReceipt(undefined), null);
    assert.equal(utils.extractE2ESessionFromRetryReceipt({ content: [] }), null);

    const optional = structuredClone(valid);
    binary.getBinaryNodeChild(optional, "keys").content =
        binary.getBinaryNodeChild(optional, "keys").content.filter((item) => item.tag !== "key");
    assert.equal(utils.extractE2ESessionFromRetryReceipt(optional).preKey, undefined);

    for (const [path, size] of [
        [["registration"], 3],
        [["keys", "type"], 0],
        [["keys", "identity"], 31],
        [["keys", "skey", "id"], 2],
        [["keys", "skey", "value"], 31],
        [["keys", "skey", "signature"], 63],
        [["keys", "key", "id"], 2],
        [["keys", "key", "value"], 31],
    ]) {
        const malformed = structuredClone(valid);
        let child = malformed;
        for (const tag of path) child = binary.getBinaryNodeChild(child, tag);
        child.content = Buffer.alloc(size);
        assert.equal(utils.extractE2ESessionFromRetryReceipt(malformed), null, path.join("/"));
    }
    const wrongType = structuredClone(valid);
    binary.getBinaryNodeChild(binary.getBinaryNodeChild(wrongType, "keys"), "type").content = Buffer.from([1]);
    assert.equal(utils.extractE2ESessionFromRetryReceipt(wrongType), null);
});

test("retry resends use the requesting device's bundle without overwriting it from the server", async () => {
    const { calls, resend } = retryHarness();
    await resend(retryKey, ["fixture"], retryNode, receipt());
    assert.deepEqual(calls.map(([action]) => action), ["bundle", "relay"]);
    assert.equal(calls[0][1].jid, retryKey.participant);
    assert.equal(calls[1][3].participant.jid, retryKey.participant);
    assert.equal(calls[1][3].participant.count, 2);
    assert.match(receiveSource, /await sendMessagesAgain\(key, ids, retryNode, node\)/);
});

test("missing or rejected retry bundles preserve the server-session fallback", async () => {
    for (const rejected of [false, true]) {
        const { calls, resend } = retryHarness(rejected);
        await resend(retryKey, ["fixture"], retryNode, rejected ? receipt() : { content: [] });
        assert.deepEqual(calls.map(([action]) => action), rejected
            ? ["bundle", "server", "relay"] : ["server", "relay"]);
        const server = calls.find(([action]) => action === "server");
        assert.equal(server[1][0], retryKey.participant);
        assert.equal(server[2], true);
    }
});

test("a primary-device retry still resends to all devices after restoring its bundle", async () => {
    const { calls, resend } = retryHarness();
    await resend({ ...retryKey, participant: "19999999999@lid" }, ["fixture"], retryNode, receipt());
    const options = calls.find(([action]) => action === "relay")[3];
    assert.equal(options.useUserDevicesCache, false);
    assert.equal(options.participant, undefined);
});

test("receipt keys replace a stale session and produce decryptable PN and LID ciphertext", async () => {
    const originalInfo = console.info;
    const logs = [];
    console.info = (...args) => logs.push(args);
    try {
        for (const server of ["s.whatsapp.net", "lid"]) {
            const sender = memoryAuth();
            const recipient = memoryAuth();
            const staleDevice = memoryAuth();
            const preKey = utils.Curve.generateKeyPair();
            await recipient.keys.set({ "pre-key": { "41": preKey } });
            const sending = makeLibSignalRepository(sender);
            const receiving = makeLibSignalRepository(recipient);
            const recipientJid = `19999999999@${server}`;
            await sending.injectE2ESession({
                jid: recipientJid,
                session: utils.extractE2ESessionFromRetryReceipt(receipt(staleDevice)),
            });
            await sending.injectE2ESession({
                jid: recipientJid,
                session: utils.extractE2ESessionFromRetryReceipt(receipt(recipient, preKey)),
            });
            const original = Buffer.from("Synthetic DM recovery");
            const encrypted = await sending.encryptMessage({ jid: recipientJid, data: original });
            const decrypted = await receiving.decryptMessage({
                jid: `15555555555:2@${server}`, ...encrypted,
            });
            assert.deepEqual(Buffer.from(decrypted), original);
        }
        assert.ok(logs.length > 0);
        assert.ok(logs.every((args) => args.every((value) => typeof value !== "object")),
            "session logs must not dump cryptographic records");
    } finally {
        console.info = originalInfo;
    }
});

test("self-chat diagnostics identify bundles and receipts without logging identities or keys", () => {
    const socket = {
        user: { id: "19999999999:2@s.whatsapp.net", lid: "18888888888:2@lid" },
        ws: new EventEmitter(),
        ev: new EventEmitter(),
    };
    const logs = [];
    trackSelfChatDelivery(socket, (line) => logs.push(line));
    const retry = receipt();
    retry.attrs.from = "18888888888:3@lid";
    retry.content.unshift(retryNode);
    socket.ws.emit("CB:receipt", retry);
    assert.equal(logs[0], "[WhatsApp] Self-chat retry: attempt=2; keyBundle=valid.");
    socket.ws.emit("CB:receipt", { attrs: { from: "19999999999@s.whatsapp.net" } });
    socket.ws.emit("CB:receipt", { attrs: { from: "18888888888@lid", type: "read" } });
    assert.match(logs[1], /device receipt: delivered/);
    assert.match(logs[2], /device receipt: read/);
    socket.ws.emit("CB:receipt", { attrs: { from: "15555555555@s.whatsapp.net", type: "retry" } });
    socket.ws.emit("CB:receipt", { attrs: {
        from: "19999999999@s.whatsapp.net", recipient: "15555555555@s.whatsapp.net", type: "retry",
    } });
    assert.equal(logs.length, 4);
    assert.equal(logs[3], "[WhatsApp] DM retry: attempt=unknown; keyBundle=absent.");
    assert.ok(logs.every((line) => !/\d{8,}|@/.test(line)));
    socket.ev.emit("connection.update", { connection: "close" });
    assert.equal(socket.ws.listenerCount("CB:receipt"), 0);
    assert.equal(socket.ev.listenerCount("connection.update"), 0);
});
