const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { collectIdentityPairs, migrateLegacyLidKeys, seedNativeLidMappings } =
    require("../RICHK-MD-core/connection/legacyAddressMigration");
const { LIDMappingStore } = require("gifted-baileys/lib/Signal/lid-mapping");
const { createTransportLogger } = require("../RICHK-MD-core/connection/transportLogger");

const pairs = [{ lid: "99880001@lid", pn: "15550000001@s.whatsapp.net" }];
function database(t, records) {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, value TEXT)");
    for (const [id, value] of Object.entries(records)) {
        db.prepare("INSERT INTO session VALUES (?, ?)").run(id, value);
    }
    t.after(() => db.close());
    return db;
}

test("legacy LID device sessions and group keys retain their exact serialized bytes", t => {
    const rows = {
        "creds": "synthetic-login",
        "session-99880001.4": "synthetic-ratchet",
        "sender-key-120000@g.us::99880001::4": "synthetic-group-ratchet",
    };
    const db = database(t, rows);
    assert.equal(migrateLegacyLidKeys(db, pairs), 2);
    const read = id => db.prepare("SELECT value FROM session WHERE id = ?").get(id)?.value;
    assert.equal(read("session-99880001_1.4"), rows["session-99880001.4"]);
    assert.equal(read("sender-key-120000@g.us::99880001_1::4"), rows["sender-key-120000@g.us::99880001::4"]);
    for (const [id, value] of Object.entries(rows)) assert.equal(read(id), value, "original state remains intact");
    assert.equal(migrateLegacyLidKeys(db, pairs), 0, "migration is idempotent");
});

test("migration never overwrites a session already advanced by upstream", t => {
    const db = database(t, {
        "session-99880001.4": "old",
        "session-99880001_1.4": "advanced",
    });
    assert.equal(migrateLegacyLidKeys(db, pairs), 0);
    assert.equal(db.prepare("SELECT value FROM session WHERE id = ?").get("session-99880001_1.4").value, "advanced");
});

test("unverified and ambiguous old identifiers cannot be copied as LID sessions", t => {
    const db = database(t, {
        "session-555.0": "ambiguous",
        "session-777.0": "unverified",
        "session-15550009999.0": "unverified-phone",
    });
    assert.equal(migrateLegacyLidKeys(db, [...pairs, { lid: "555@lid", pn: "555@s.whatsapp.net" }]), 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM session").get().count, 3);
});

test("verified PN aliases are migrated before native mapping can redirect their reads", t => {
    const db = database(t, {
        "session-15550000001.4": "phone-ratchet",
        "sender-key-120000@g.us::15550000001::4": "phone-group-ratchet",
    });
    assert.equal(migrateLegacyLidKeys(db, pairs), 2);
    assert.equal(db.prepare("SELECT value FROM session WHERE id = ?").get("session-99880001_1.4").value, "phone-ratchet");
    assert.equal(db.prepare("SELECT value FROM session WHERE id = ?").get("sender-key-120000@g.us::99880001_1::4").value, "phone-group-ratchet");
});

test("device 99 receives the hosted LID namespace rather than an ordinary LID address", t => {
    const db = database(t, { "session-99880001.99": "hosted-session" });
    assert.equal(migrateLegacyLidKeys(db, pairs), 1);
    assert.equal(db.prepare("SELECT value FROM session WHERE id = ?").get("session-99880001_129.99").value, "hosted-session");
});

test("native mappings are seeded without replacing newer conflicting identities", async () => {
    const data = {};
    const keys = {
        async get(type, ids) { return Object.fromEntries(ids.map(id => [id, data[type]?.[id]])); },
        async set(update) {
            for (const [type, values] of Object.entries(update)) Object.assign(data[type] ||= {}, values);
        },
    };
    await seedNativeLidMappings(keys, pairs);
    const native = new LIDMappingStore(keys, createTransportLogger());
    assert.equal(require("gifted-baileys").jidNormalizedUser(await native.getPNForLID(pairs[0].lid)), pairs[0].pn);
    await seedNativeLidMappings(keys, [{ lid: pairs[0].lid, pn: "15550009999@s.whatsapp.net" }]);
    assert.equal(require("gifted-baileys").jidNormalizedUser(await native.getPNForLID(pairs[0].lid)), pairs[0].pn);
});

test("reciprocal native mappings protect private peers absent from older group metadata", t => {
    const db = database(t, {
        "lid-mapping-15550000001": JSON.stringify("99880002"),
        "lid-mapping-99880002_reverse": JSON.stringify("15550000001"),
    });
    assert.deepEqual(collectIdentityPairs(db, pairs), [
        { pn: "15550000001@s.whatsapp.net", lid: "99880002@lid" },
    ]);
});

test("one-sided native mappings cannot authorize an encryption-state migration", t => {
    const db = database(t, {
        "lid-mapping-99880002_reverse": JSON.stringify("15550000001"),
    });
    assert.deepEqual(collectIdentityPairs(db, []), []);
});
