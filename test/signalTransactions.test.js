const test = require("node:test");
const assert = require("node:assert/strict");
const { addTransactionCapability, makeCacheableSignalKeyStore } = require("gifted-baileys/lib/Utils/auth-utils");
const { initAuthCreds, generateSignalPubKey, Curve } = require("gifted-baileys/lib/Utils");
const { makeAtomicSignalRepository } = require("../RICHK-MD-core/connection/atomicSignalRepository");

const logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };
const options = { maxCommitRetries: 2, delayBetweenTriesMs: 1 };
const latch = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
function memoryState() {
    const data = {};
    return {
        data,
        async get(type, ids) {
            return Object.fromEntries(ids.map(id => [id, data[type]?.[id]]));
        },
        async set(update) {
            for (const [type, values] of Object.entries(update)) {
                Object.assign(data[type] || (data[type] = {}), structuredClone(values));
            }
        },
    };
}
function auth() {
    const state = memoryState();
    return { creds: initAuthCreds(), keys: addTransactionCapability(state, logger, options), state };
}
function bundle(peer) {
    return {
        registrationId: peer.creds.registrationId,
        identityKey: generateSignalPubKey(peer.creds.signedIdentityKey.public),
        signedPreKey: {
            keyId: peer.creds.signedPreKey.keyId,
            publicKey: generateSignalPubKey(peer.creds.signedPreKey.keyPair.public),
            signature: peer.creds.signedPreKey.signature,
        },
    };
}

test("overlapping callers never lose a session write during another commit", async () => {
    const state = memoryState(), entered = latch(), release = latch();
    let commits = 0;
    const save = state.set.bind(state);
    state.set = async data => {
        const snapshot = structuredClone(data);
        if (++commits === 1) { entered.resolve(); await release.promise; }
        await save(snapshot);
    };
    const keys = addTransactionCapability(state, logger, options);
    const first = keys.transaction(async () => keys.set({ session: { first: "synthetic-A" } }));
    await entered.promise;
    let secondStarted = false;
    const second = keys.transaction(async () => {
        secondStarted = true;
        await keys.set({ session: { second: "synthetic-B" } });
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(secondStarted, false);
    release.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(state.data.session, { first: "synthetic-A", second: "synthetic-B" });
    assert.equal(commits, 2);
});

test("failed work rolls back and unrelated readers never see uncommitted keys", async () => {
    const state = memoryState(), entered = latch(), release = latch();
    const keys = addTransactionCapability(state, logger, options);
    const failing = keys.transaction(async () => {
        await keys.set({ session: { hidden: "uncommitted" } });
        entered.resolve(); await release.promise;
        throw new Error("synthetic rollback");
    });
    await entered.promise;
    assert.equal(keys.isInTransaction(), false);
    assert.equal((await keys.get("session", ["hidden"])).hidden, undefined);
    release.resolve();
    await assert.rejects(failing, /synthetic rollback/);
    assert.equal((await keys.get("session", ["hidden"])).hidden, undefined);
    await keys.transaction(async () => keys.set({ session: { later: "persisted" } }));
    assert.equal(state.data.session.later, "persisted");
});

test("nested operations share one commit; exhausted commit failures are not reported as success", async () => {
    const state = memoryState(), keys = addTransactionCapability(state, logger, options);
    await keys.transaction(async () => {
        await keys.set({ session: { a: "first" } });
        await keys.transaction(async () => keys.set({ session: { b: "nested" } }));
    });
    assert.deepEqual(state.data.session, { a: "first", b: "nested" });
    let attempts = 0;
    const broken = addTransactionCapability({
        get: state.get.bind(state),
        async set() { attempts++; throw new Error("synthetic disk failure"); },
    }, logger, options);
    await assert.rejects(broken.transaction(async () => broken.set({ session: { c: "not persisted" } })), /disk failure/);
    assert.equal(attempts, 2);
});

test("parallel PN and LID sends decrypt and retained sessions survive repository reload", async () => {
    const sender = auth(), receiver = auth();
    let sending = makeAtomicSignalRepository(sender);
    const receiving = makeAtomicSignalRepository(receiver);
    const chats = [
        ["15550000002@s.whatsapp.net", "15550000001:4@s.whatsapp.net"],
        ["99880002@lid", "99880001:4@lid"],
    ];
    for (const [recipient] of chats) await sending.injectE2ESession({ jid: recipient, session: bundle(receiver) });
    const sends = await Promise.all(Array.from({ length: 16 }, (_, i) => {
        const [recipient, author] = chats[i % chats.length];
        return sending.encryptMessage({ jid: recipient, data: Buffer.from(`Pong ${i}`) })
            .then(encrypted => ({ ...encrypted, author, i }));
    }));
    for (const sent of sends) {
        const plain = await receiving.decryptMessage({ jid: sent.author, type: sent.type, ciphertext: sent.ciphertext });
        assert.equal(Buffer.from(plain).toString(), `Pong ${sent.i}`);
    }
    // Simulate a process restart with committed storage, not transient tx caches.
    sender.keys = addTransactionCapability(sender.state, logger, options);
    sending = makeAtomicSignalRepository(sender);
    for (const [recipient, author] of chats) {
        const sent = await sending.encryptMessage({ jid: recipient, data: Buffer.from("After reload") });
        const plain = await receiving.decryptMessage({ jid: author, ...sent });
        assert.equal(Buffer.from(plain).toString(), "After reload");
    }
});

test("signed-prekey and signature verification reject tampering without replacing sessions", async () => {
    const sender = auth(), receiver = auth(), repository = makeAtomicSignalRepository(sender);
    const corrupted = bundle(receiver);
    corrupted.signedPreKey.signature = Buffer.alloc(64);
    await assert.rejects(repository.injectE2ESession({
        jid: "15550000002@s.whatsapp.net", session: corrupted,
    }), /signature/);
    assert.deepEqual(sender.state.data, {});
    const pair = Curve.generateKeyPair(), data = Buffer.from("signature control");
    const signature = Curve.sign(pair.private, data);
    assert.equal(Curve.verify(pair.public, data, signature), true);
    assert.equal(Curve.verify(pair.public, Buffer.from("altered control"), signature), false);
});

test("failed durable writes never publish phantom sessions in the cache", async () => {
    const cache = new Map();
    const keys = makeCacheableSignalKeyStore({
        async get() { return {}; },
        async set() { throw new Error("synthetic write failure"); },
    }, logger, cache);
    await assert.rejects(keys.set({ session: { peer: "not persisted" } }), /write failure/);
    assert.equal((await keys.get("session", ["peer"])).peer, undefined);
    assert.equal(cache.size, 0);
});

test("SQLite key batches roll back if one key cannot be written", async () => {
    const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
    const Database = require("better-sqlite3");
    const source = fs.readFileSync(path.join(__dirname, "../RICHK-MD-core/gmdFunctions.js"), "utf8");
    const start = source.indexOf("async function useSQLiteAuthState(");
    const end = source.indexOf("const runtime =", start);
    const coreRequire = require("node:module").createRequire(path.join(__dirname, "../RICHK-MD-core/gmdFunctions.js"));
    const scopedRequire = id => id === "./database/lidMapping"
        ? { getPersistedLidMappings: async () => [] }
        : coreRequire(id);
    const load = new Function("require", "fs", "path", `${source.slice(start, end)}; return useSQLiteAuthState;`)(scopedRequire, fs, path);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "richk-atomic-keys-"));
    const file = path.join(dir, "session.db");
    let db;
    try {
        fs.writeFileSync(path.join(dir, "creds.json"), JSON.stringify({ fixture: true }));
        const { state } = await load(file);
        db = new Database(file);
        db.exec("CREATE TRIGGER reject_bad_key BEFORE INSERT ON session WHEN NEW.id='session-bad' BEGIN SELECT RAISE(ABORT,'synthetic key failure'); END;");
        await assert.rejects(state.keys.set({ session: { first: "should roll back", bad: "rejected" } }), /key failure/);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM session WHERE id LIKE 'session-%'").get().count, 0);
        await state.keys.set({ session: { healthy: "committed" } });
        assert.equal((await state.keys.get("session", ["healthy"])).healthy, "committed");
    } finally {
        db?.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("native keyed transactions keep fresh crypto available during unrelated waits", async () => {
    const sender = auth(), receiver = auth();
    const sending = makeAtomicSignalRepository(sender), receiving = makeAtomicSignalRepository(receiver);
    await sending.injectE2ESession({ jid: "15550000002@s.whatsapp.net", session: bundle(receiver) });
    const runRelay = work => sender.keys.transaction(work, "historical-relay");
    const entered = latch(), discovery = latch();
    const historicalRetry = runRelay(async () => {
        entered.resolve();
        await discovery.promise; // Represents a slow USync/key-server/metadata query.
        return sending.encryptMessage({ jid: "15550000002@s.whatsapp.net", data: Buffer.from("Old resend") });
    });
    await entered.promise;
    try {
        const fresh = await Promise.race([
            sending.encryptMessage({ jid: "15550000002@s.whatsapp.net", data: Buffer.from("Fresh Pong") }),
            new Promise((_, reject) => {
                const timer = setTimeout(() => reject(new Error("fresh reply blocked by discovery")), 500);
                timer.unref();
            }),
        ]);
        const plain = await receiving.decryptMessage({ jid: "15550000001:4@s.whatsapp.net", ...fresh });
        assert.equal(Buffer.from(plain).toString(), "Fresh Pong");
    } finally {
        discovery.resolve();
        const historical = await historicalRetry;
        const plain = await receiving.decryptMessage({ jid: "15550000001:4@s.whatsapp.net", ...historical });
        assert.equal(Buffer.from(plain).toString(), "Old resend");
    }
});

test("pre-key uploads persist private keys before a slow server query and leave crypto available", async () => {
    const fs = require("node:fs"), vm = require("node:vm");
    const source = fs.readFileSync(require.resolve("gifted-baileys/lib/Socket/socket"), "utf8");
    const begin = source.indexOf("const uploadPreKeys = async");
    const end = source.indexOf("const uploadPreKeysToServerIfRequired", begin);
    const sender = auth(), receiver = auth(), sending = makeAtomicSignalRepository(sender);
    const receiving = makeAtomicSignalRepository(receiver), entered = latch(), response = latch();
    await sending.injectE2ESession({ jid: "15550000002@s.whatsapp.net", session: bundle(receiver) });
    const upload = vm.runInNewContext(`${source.slice(begin, end)}; uploadPreKeys`, {
        uploadPreKeysPromise: undefined,
        MIN_PREKEY_COUNT: 1,
        UPLOAD_TIMEOUT: 10000,
        Boom: require("@hapi/boom").Boom,
        getNextPreKeysNode: require("gifted-baileys").getNextPreKeysNode,
        setTimeout: (work, ms) => { const timer = setTimeout(work, ms); timer.unref(); return timer; },
        Defaults_1: { INITIAL_PREKEY_COUNT: 1 },
        Utils_1: require("gifted-baileys/lib/Utils"),
        creds: sender.creds,
        keys: sender.keys,
        logger: { debug() {}, info() {}, error() {} },
        ev: { emit(_, update) { Object.assign(sender.creds, update); } },
        async query() {
            assert.ok(Object.keys(sender.state.data["pre-key"] || {}).length > 0, "private keys must already be durable");
            entered.resolve();
            await response.promise;
        },
    });
    const pendingUpload = upload(1);
    await entered.promise;
    try {
        const sent = await Promise.race([
            sending.encryptMessage({ jid: "15550000002@s.whatsapp.net", data: Buffer.from("Pong during upload") }),
            new Promise((_, reject) => {
                const timer = setTimeout(() => reject(new Error("key-server query blocked fresh crypto")), 500);
                timer.unref();
            }),
        ]);
        assert.equal(Buffer.from(await receiving.decryptMessage({
            jid: "15550000001:4@s.whatsapp.net", ...sent,
        })).toString(), "Pong during upload");
    } finally {
        response.resolve();
        await pendingUpload;
    }
});
