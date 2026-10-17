const { jidDecode, jidNormalizedUser } = require("gifted-baileys");
const { LIDMappingStore } = require("gifted-baileys/lib/Signal/lid-mapping");
const { addTransactionCapability } = require("gifted-baileys/lib/Utils/auth-utils");
const { createTransportLogger } = require("./transportLogger");

function normalizePairs(pairs) {
    return pairs.map(({ lid, pn, jid }) => ({
        lid: jidNormalizedUser(lid || ""),
        pn: jidNormalizedUser(pn || jid || ""),
    })).filter(pair => pair.lid.endsWith("@lid") && pair.pn.endsWith("@s.whatsapp.net"));
}

function collectIdentityPairs(db, persisted, me = {}) {
    const native = [];
    const read = db.prepare("SELECT value FROM session WHERE id = ?");
    for (const row of db.prepare("SELECT id, value FROM session WHERE id LIKE 'lid-mapping-%_reverse'").all()) {
        const lid = /^lid-mapping-(\d+)_reverse$/.exec(row.id)?.[1];
        const pn = JSON.parse(row.value);
        if (!lid || !/^\d+$/.test(pn)) continue;
        const forward = read.get(`lid-mapping-${pn}`);
        if (forward && JSON.parse(forward.value) === lid) {
            native.push({ lid: `${lid}@lid`, pn: `${pn}@s.whatsapp.net` });
        }
    }
    if (me.id && me.lid) {
        const own = normalizePairs([{ pn: me.id, lid: me.lid }])[0];
        if (own) {
            for (let i = native.length - 1; i >= 0; i--) {
                if (native[i].pn === own.pn || native[i].lid === own.lid) native.splice(i, 1);
            }
            native.push(own);
        }
    }
    const byPn = new Map(native.map(pair => [pair.pn, pair.lid]));
    const byLid = new Map(native.map(pair => [pair.lid, pair.pn]));
    const older = normalizePairs(persisted).filter(pair =>
        (!byPn.has(pair.pn) || byPn.get(pair.pn) === pair.lid) &&
        (!byLid.has(pair.lid) || byLid.get(pair.lid) === pair.pn));
    return [...older, ...native];
}

function migrateLegacyLidKeys(db, pairs) {
    const identities = normalizePairs(pairs);
    const lids = new Set(identities.map(pair => jidDecode(pair.lid).user));
    const phones = new Set(identities.map(pair => jidDecode(pair.pn).user));
    const phoneToLids = new Map();
    for (const pair of identities) {
        const phone = jidDecode(pair.pn).user;
        const linked = phoneToLids.get(phone) || new Set();
        linked.add(jidDecode(pair.lid).user);
        phoneToLids.set(phone, linked);
    }
    const rows = db.prepare(
        "SELECT id FROM session WHERE id LIKE 'session-%' OR id LIKE 'sender-key-%'",
    ).all();
    const copy = db.prepare(
        "INSERT OR IGNORE INTO session (id, value) SELECT ?, value FROM session WHERE id = ?",
    );
    return db.transaction(() => {
        let copied = 0;
        // Prefer an explicitly LID-addressed legacy record when both alias
        // records exist, without ever replacing a native destination.
        for (const { id } of rows.sort((a, b) => {
            const user = row => /^session-(\d+)\./.exec(row.id)?.[1] || /::(\d+)::/.exec(row.id)?.[1];
            return Number(!lids.has(user(a))) - Number(!lids.has(user(b)));
        })) {
            const direct = /^session-(\d+)\.(\d+)$/.exec(id);
            const group = /^sender-key-(.+)::(\d+)::(\d+)$/.exec(id);
            const user = direct?.[1] || group?.[2];
            const device = Number(direct?.[2] || group?.[3]);
            // The retired fork discarded domains. An ambiguous identifier
            // cannot safely be reclassified, even if it resembles a LID.
            if (!user || !Number.isSafeInteger(device) || (lids.has(user) && phones.has(user))) continue;
            const linked = phoneToLids.get(user);
            const lidUser = lids.has(user) ? user : linked?.size === 1 ? [...linked][0] : null;
            if (!lidUser) continue;
            const server = device === 99 ? "hosted.lid" : "lid";
            const domain = jidDecode(`${lidUser}:${device}@${server}`).domainType;
            const nativeUser = `${lidUser}_${domain}`;
            const target = direct
                ? `session-${nativeUser}.${device}`
                : `sender-key-${group[1]}::${nativeUser}::${device}`;
            copied += copy.run(target, id).changes;
        }
        return copied;
    })();
}

async function seedNativeLidMappings(keys, pairs) {
    const logger = createTransportLogger();
    const transactional = addTransactionCapability(keys, logger, {
        maxCommitRetries: 2, delayBetweenTriesMs: 10,
    });
    const store = new LIDMappingStore(transactional, logger);
    const missing = [];
    for (const pair of normalizePairs(pairs)) {
        const pn = jidNormalizedUser(await store.getPNForLID(pair.lid) || "");
        const lid = jidNormalizedUser(await store.getLIDForPN(pair.pn) || "");
        // An address learned by the active upstream transport wins over
        // older app metadata. Never replace a conflicting native mapping.
        if ((pn && pn !== pair.pn) || (lid && lid !== pair.lid)) continue;
        if (!pn || !lid) missing.push(pair);
    }
    if (missing.length) await store.storeLIDPNMappings(missing);
}

module.exports = { collectIdentityPairs, migrateLegacyLidKeys, seedNativeLidMappings };
