const { AsyncLocalStorage } = require("node:async_hooks");
const { Mutex } = require("async-mutex");

// Transaction contexts must belong to the caller, not to the entire socket.
function addTransactionCapability(state, logger, options = {}) {
    const contexts = new AsyncLocalStorage();
    const locks = new Map();
    const retries = Math.max(1, options.maxCommitRetries || 3);
    const delay = options.delayBetweenTriesMs ?? 10;
    const keys = {
        async get(type, ids) {
            const context = contexts.getStore();
            if (!context) return state.get(type, ids);
            const cache = context.cache[type] ||= {};
            const missing = ids.filter(id => !Object.hasOwn(cache, id));
            if (missing.length) {
                const loaded = await state.get(type, missing);
                for (const id of missing) cache[id] = loaded[id];
            }
            return Object.fromEntries(ids.map(id => [id, cache[id]]));
        },
        async set(update) {
            const context = contexts.getStore();
            if (!context) return state.set(update);
            for (const [type, values] of Object.entries(update)) {
                Object.assign(context.cache[type] ||= {}, values);
                Object.assign(context.pending[type] ||= {}, values);
            }
        },
        isInTransaction() { return !!contexts.getStore(); },
        async transaction(work, key = "default") {
            if (contexts.getStore()) return work();
            let entry = locks.get(key);
            if (!entry) {
                entry = { mutex: new Mutex(), callers: 0 };
                locks.set(key, entry);
            }
            entry.callers++;
            try {
                return await entry.mutex.runExclusive(() => contexts.run(
                    { cache: {}, pending: {} },
                    async () => {
                        const result = await work();
                        const pending = contexts.getStore().pending;
                        if (Object.keys(pending).length) {
                            for (let attempt = 0; ; attempt++) {
                                try { await state.set(pending); break; }
                                catch (error) {
                                    if (attempt + 1 >= retries) throw error;
                                    await new Promise(resolve => setTimeout(resolve, delay));
                                }
                            }
                        }
                        return result;
                    },
                ));
            } finally {
                if (--entry.callers === 0) locks.delete(key);
            }
        },
    };
    return keys;
}

function makeCacheableSignalKeyStore(state, logger) {
    const cache = new Map();
    const mutex = new Mutex();
    const remember = (name, value) => {
        if (!cache.has(name) && cache.size >= 4096) cache.delete(cache.keys().next().value);
        cache.set(name, value);
    };
    return {
        get: (type, ids) => mutex.runExclusive(async () => {
            const missing = ids.filter(id => !cache.has(`${type}:${id}`));
            if (missing.length) {
                const loaded = await state.get(type, missing);
                for (const id of missing) {
                    if (loaded[id] !== undefined) remember(`${type}:${id}`, loaded[id]);
                }
            }
            return Object.fromEntries(ids.map(id => [id, cache.get(`${type}:${id}`)]));
        }),
        set: update => mutex.runExclusive(async () => {
            // Failed durable writes must never become cached successes.
            await state.set(update);
            for (const [type, values] of Object.entries(update)) {
                for (const [id, value] of Object.entries(values)) {
                    const name = `${type}:${id}`;
                    if (value == null) cache.delete(name); else remember(name, value);
                }
            }
        }),
        async clear() { cache.clear(); await state.clear?.(); },
    };
}

module.exports = { addTransactionCapability, makeCacheableSignalKeyStore };
