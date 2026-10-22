const NodeCache = require("node-cache");
const pendingMetadata = new WeakMap();
const retryAfter = new WeakMap();
const revisions = new Map();
let cacheGeneration = 0;

const groupCache = new NodeCache({
    stdTTL: 5 * 60,
    useClones: false,
    checkperiod: 60,
});

const lidToJidStore = new NodeCache({
    stdTTL: 24 * 60 * 60,
    useClones: false,
    checkperiod: 300,
});

const storeLidMapping = (lid, jid) => {
    if (lid && jid && lid.endsWith("@lid") && jid.endsWith("@s.whatsapp.net")) {
        lidToJidStore.set(lid, jid);
    }
};

const getLidMapping = (lid) => {
    return lidToJidStore.get(lid);
};

const updateLidMappingsFromMetadata = (metadata) => {
    if (!metadata?.participants) return;
    for (const p of metadata.participants) {
        const lid = p.lid || p.id;
        const jid = p.pn || p.phoneNumber || p.jid;
        if (lid && jid) {
            storeLidMapping(lid, jid);
        }
    }
};

const isExpectedError = (errorMsg) => {
    const expectedErrors = [
        "forbidden",
        "item-not-found",
        "not-authorized",
        "gone",
    ];
    return expectedErrors.some((e) => errorMsg?.toLowerCase().includes(e));
};

const getGroupMetadata = async (Gifted, jid, { forceRefresh = false } = {}) => {
    if (!jid || !jid.endsWith("@g.us")) return null;
    const cached = forceRefresh ? null : groupCache.get(jid);
    if (cached) return cached;
    let pending = pendingMetadata.get(Gifted);
    if (!pending) pendingMetadata.set(Gifted, pending = new Map());
    let cooldowns = retryAfter.get(Gifted);
    if (!cooldowns) retryAfter.set(Gifted, cooldowns = new Map());
    if (!forceRefresh && (cooldowns.get(jid) || 0) > Date.now()) return null;
    const revision = revisions.get(jid) || 0;
    const generation = cacheGeneration;
    const active = pending.get(jid);
    if (active?.revision === revision && active.generation === generation) return active.promise;
    const request = { revision, generation };
    request.promise = Promise.resolve().then(async () => {
        try {
            const metadata = await Gifted.groupMetadata(jid);
            if (revision !== (revisions.get(jid) || 0) || generation !== cacheGeneration) return null;
            if (metadata) {
                groupCache.set(jid, metadata);
                updateLidMappingsFromMetadata(metadata);
                cooldowns.delete(jid);
            } else {
                cooldowns.set(jid, Date.now() + 5000);
            }
            return metadata;
        } catch (error) {
            cooldowns.set(jid, Date.now() + 5000);
            if (!isExpectedError(error.message)) console.warn("[Groups] Metadata temporarily unavailable.");
            return null;
        } finally {
            if (pending.get(jid) === request) pending.delete(jid);
        }
    });
    pending.set(jid, request);
    return request.promise;
};

const updateGroupCache = (jid, metadata) => {
    if (jid && metadata) {
        revisions.set(jid, (revisions.get(jid) || 0) + 1);
        groupCache.set(jid, metadata);
        updateLidMappingsFromMetadata(metadata);
    }
};

const deleteGroupCache = (jid) => {
    revisions.set(jid, (revisions.get(jid) || 0) + 1);
    groupCache.del(jid);
};

const clearGroupCache = () => {
    cacheGeneration++;
    revisions.clear();
    groupCache.flushAll();
};

const setupGroupCacheListeners = (Gifted) => {
    const refresh = async (event) => {
        if (!event?.id) return;
        deleteGroupCache(event.id);
        await getGroupMetadata(Gifted, event.id, { forceRefresh: true });
    };
    Gifted.ev.on("groups.update", async (events = []) => Promise.all(events.map(refresh)));
    Gifted.ev.on("group-participants.update", refresh);
};

const cachedGroupMetadata = async (jid) => {
    return groupCache.get(jid);
};

const initializeLidStore = async (Gifted) => {
    try {
        const groups = await Gifted.groupFetchAllParticipating();
        if (groups) {
            for (const groupJid of Object.keys(groups)) {
                const meta = groups[groupJid];
                if (meta?.participants) {
                    updateLidMappingsFromMetadata(meta);
                    groupCache.set(groupJid, meta);
                }
            }
            console.log(
                `✅ LID store initialized => ${lidToJidStore.keys().length} Mappings from ${Object.keys(groups).length} Groups`,
            );
        }
    } catch (error) {
        console.error("Failed to initialize LID store:", error.message);
    }
};

module.exports = {
    groupCache,
    getGroupMetadata,
    updateGroupCache,
    deleteGroupCache,
    clearGroupCache,
    setupGroupCacheListeners,
    cachedGroupMetadata,
    getLidMapping,
    storeLidMapping,
    updateLidMappingsFromMetadata,
    initializeLidStore,
};
