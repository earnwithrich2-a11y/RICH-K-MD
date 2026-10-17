const test = require("node:test");
const assert = require("node:assert/strict");
const sdk = require("gifted-baileys");
const { addTransactionCapability } = require("gifted-baileys/lib/Utils/auth-utils");
const { makeAtomicSignalRepository } = require("../RICHK-MD-core/connection/atomicSignalRepository");
const { createTransportLogger } = require("../RICHK-MD-core/connection/transportLogger");

// Independent synthetic devices only. Never load the active WhatsApp login.
function device() {
    const saved = {};
    const state = {
        async get(type, ids) { return Object.fromEntries(ids.map(id => [id, saved[type]?.[id]])); },
        async set(update) {
            for (const [type, values] of Object.entries(update)) Object.assign(saved[type] ||= {}, values);
        },
    };
    const auth = {
        creds: sdk.initAuthCreds(),
        keys: addTransactionCapability(state, createTransportLogger(), {
            maxCommitRetries: 2, delayBetweenTriesMs: 1,
        }),
    };
    return { auth, repository: makeAtomicSignalRepository(auth) };
}
function bundle(peer) {
    const creds = peer.auth.creds;
    return {
        registrationId: creds.registrationId,
        identityKey: sdk.generateSignalPubKey(creds.signedIdentityKey.public),
        signedPreKey: {
            keyId: creds.signedPreKey.keyId,
            publicKey: sdk.generateSignalPubKey(creds.signedPreKey.keyPair.public),
            signature: creds.signedPreKey.signature,
        },
    };
}
function decode(bytes) {
    return sdk.proto.Message.decode(sdk.unpadRandomMax16(Buffer.from(bytes)));
}

test("legacy plugin imports and the actual socket use the supported pinned Baileys SDK", () => {
    const pkg = require("@whiskeysockets/baileys/package.json");
    assert.equal(pkg.name, "@whiskeysockets/baileys");
    assert.equal(pkg.version, "7.0.0-rc14");
    assert.equal(require("../package.json").dependencies["@whiskeysockets/baileys"], "7.0.0-rc14");
    assert.equal(sdk.default, require("@whiskeysockets/baileys").default);
});

test("upstream ESM socket internals and CommonJS plugins share the protected key transaction implementation", () => {
    const native = require("@whiskeysockets/baileys/lib/Utils/auth-utils.js");
    const protectedKeys = require("../RICHK-MD-core/connection/signalKeyTransactions");
    assert.equal(native.addTransactionCapability, protectedKeys.addTransactionCapability);
    assert.equal(native.makeCacheableSignalKeyStore, protectedKeys.makeCacheableSignalKeyStore);
    assert.equal(sdk.makeCacheableSignalKeyStore, protectedKeys.makeCacheableSignalKeyStore);
    const nativeCurve = require("@whiskeysockets/baileys").Curve;
    const pair = nativeCurve.generateKeyPair(), data = Buffer.from("native signature control");
    const signature = nativeCurve.sign(pair.private, data);
    assert.equal(nativeCurve.verify(pair.public, data, signature), true);
    assert.equal(nativeCurve.verify(pair.public, Buffer.from("tampered"), signature), false);
});

test("phone, LID and hosted-device session addresses cannot collide", () => {
    const { repository } = device();
    const addresses = [
        "15550000001:4@s.whatsapp.net", "15550000001:4@lid",
        "15550000001:99@hosted", "15550000001:99@hosted.lid",
    ].map(jid => repository.jidToSignalProtocolAddress(jid));
    assert.equal(new Set(addresses).size, 4);
    assert.equal(addresses[1], "15550000001_1.4");
    assert.throws(() => repository.jidToSignalProtocolAddress("15550000001:99@s.whatsapp.net"), /non-hosted/);
});

for (const namespace of ["s.whatsapp.net", "lid"]) {
    test(`a protobuf text reply encrypts and decodes at the ${namespace} recipient`, async () => {
        const sender = device(), receiver = device();
        const destination = `15550000002@${namespace}`, author = `15550000001:4@${namespace}`;
        await sender.repository.injectE2ESession({ jid: destination, session: bundle(receiver) });
        const content = await sdk.generateWAMessageContent({ text: "Pong: readable test" }, {});
        const encrypted = await sender.repository.encryptMessage({
            jid: destination, data: sdk.encodeWAMessage(content),
        });
        const decoded = decode(await receiver.repository.decryptMessage({ jid: author, ...encrypted }));
        assert.equal(decoded.extendedTextMessage?.text || decoded.conversation, "Pong: readable test");
    });
}

test("native PN-to-LID migration preserves the ratchet instead of discarding the login", async () => {
    const sender = device(), receiver = device();
    const peerPn = "15550000002@s.whatsapp.net", peerLid = "99880002@lid";
    const ownPn = "15550000001:4@s.whatsapp.net", ownLid = "99880001:4@lid";
    await sender.repository.injectE2ESession({ jid: peerPn, session: bundle(receiver) });
    let encrypted = await sender.repository.encryptMessage({ jid: peerPn, data: sdk.encodeWAMessage({ conversation: "Before" }) });
    assert.equal(decode(await receiver.repository.decryptMessage({ jid: ownPn, ...encrypted })).conversation, "Before");
    const acknowledgement = await receiver.repository.encryptMessage({
        jid: ownPn, data: sdk.encodeWAMessage({ conversation: "Acknowledged" }),
    });
    assert.equal(decode(await sender.repository.decryptMessage({
        jid: peerPn, ...acknowledgement,
    })).conversation, "Acknowledged");
    await sender.auth.keys.set({ "device-list": { "15550000002": ["0"] } });
    await receiver.auth.keys.set({ "device-list": { "15550000001": ["4"] } });
    await sender.repository.lidMapping.storeLIDPNMappings([{ pn: peerPn, lid: peerLid }]);
    await receiver.repository.lidMapping.storeLIDPNMappings([{ pn: "15550000001@s.whatsapp.net", lid: "99880001@lid" }]);
    const migrated = await sender.repository.migrateSession(peerPn, peerLid);
    await receiver.repository.migrateSession("15550000001@s.whatsapp.net", "99880001@lid");
    assert.equal(migrated.migrated, 1);
    encrypted = await sender.repository.encryptMessage({ jid: peerLid, data: sdk.encodeWAMessage({ conversation: "After" }) });
    assert.equal(encrypted.type, "msg", "migration must retain the established ratchet");
    assert.equal(decode(await receiver.repository.decryptMessage({ jid: ownLid, ...encrypted })).conversation, "After");
});

test("a LID group reply decodes after native sender-key distribution", async () => {
    const sender = device(), receiver = device();
    const group = "120000000000000000@g.us", author = "99880001:4@lid";
    const encrypted = await sender.repository.encryptGroupMessage({
        group, meId: author, data: sdk.encodeWAMessage({ conversation: "Group Pong" }),
    });
    await receiver.repository.processSenderKeyDistributionMessage({
        authorJid: author,
        item: { groupId: group, axolotlSenderKeyDistributionMessage: encrypted.senderKeyDistributionMessage },
    });
    const plain = await receiver.repository.decryptGroupMessage({ group, authorJid: author, msg: encrypted.ciphertext });
    assert.equal(decode(plain).conversation, "Group Pong");
});

test("native retry receipts restore the recipient bundle without private credentials", () => {
    const peer = device();
    const node = {
        tag: "receipt", attrs: { type: "retry" },
        content: [
            { tag: "registration", attrs: {}, content: sdk.encodeBigEndian(peer.auth.creds.registrationId) },
            { tag: "keys", attrs: {}, content: [
                { tag: "type", attrs: {}, content: Buffer.from([5]) },
                { tag: "identity", attrs: {}, content: peer.auth.creds.signedIdentityKey.public },
                sdk.xmppSignedPreKey(peer.auth.creds.signedPreKey),
            ] },
        ],
    };
    const restored = sdk.extractE2ESessionFromRetryReceipt(node);
    assert.equal(restored.identityKey.length, 33);
    assert.equal(restored.signedPreKey.signature.length, 64);
    assert.equal(restored.preKey, undefined);
});

for (const oldNamespace of ["s.whatsapp.net", "lid"]) {
    test(`a saved legacy ${oldNamespace} ratchet decodes after the guarded SQLite migration`, async t => {
        const Database = require("better-sqlite3");
        const { migrateLegacyLidKeys } = require("../RICHK-MD-core/connection/legacyAddressMigration");
        const sender = device(), receiver = device();
        const ownPn = "15550000001@s.whatsapp.net", ownLid = "99880001@lid";
        const peerPn = "15550000002@s.whatsapp.net", peerLid = "99880002@lid";
        const destination = oldNamespace === "lid" ? peerLid : peerPn;
        const author = `${oldNamespace === "lid" ? "99880001" : "15550000001"}:4@${oldNamespace}`;
        await sender.repository.injectE2ESession({ jid: destination, session: bundle(receiver) });
        let ciphertext = await sender.repository.encryptMessage({ jid: destination, data: sdk.encodeWAMessage({ conversation: "Before upgrade" }) });
        await receiver.repository.decryptMessage({ jid: author, ...ciphertext });
        const ack = await receiver.repository.encryptMessage({ jid: author, data: sdk.encodeWAMessage({ conversation: "Ack" }) });
        await sender.repository.decryptMessage({ jid: destination, ...ack });
        const db = new Database(":memory:");
        t.after(() => db.close());
        db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, value TEXT)");
        const insert = db.prepare("INSERT INTO session VALUES (?, ?)");
        for (const [endpoint, jid] of [[sender, destination], [receiver, author]]) {
            const address = endpoint.repository.jidToSignalProtocolAddress(jid);
            const record = (await endpoint.auth.keys.get("session", [address]))[address];
            const decoded = sdk.jidDecode(jid);
            // Simulate the retired fork's domainless storage identifiers.
            insert.run(`session-${decoded.user}.${decoded.device || 0}`, JSON.stringify(record, sdk.BufferJSON.replacer));
        }
        const pairs = [{ pn: ownPn, lid: ownLid }, { pn: peerPn, lid: peerLid }];
        assert.equal(migrateLegacyLidKeys(db, pairs), 2);
        const senderAddress = "99880002_1.0", receiverAddress = "99880001_1.4";
        for (const [endpoint, address] of [[sender, senderAddress], [receiver, receiverAddress]]) {
            const row = db.prepare("SELECT value FROM session WHERE id = ?").get(`session-${address}`);
            await endpoint.auth.keys.set({ session: { [address]: JSON.parse(row.value, sdk.BufferJSON.reviver) } });
            await endpoint.repository.lidMapping.storeLIDPNMappings(pairs);
        }
        ciphertext = await sender.repository.encryptMessage({ jid: peerLid, data: sdk.encodeWAMessage({ conversation: "After upgrade" }) });
        assert.equal(ciphertext.type, "msg", "existing ratchets must be reused");
        const content = decode(await receiver.repository.decryptMessage({ jid: "99880001:4@lid", ...ciphertext }));
        assert.equal(content.conversation, "After upgrade");
    });
}
