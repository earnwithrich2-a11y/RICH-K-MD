const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadSettingsWithMockDatabase() {
    const settingsPath = require.resolve("../RICHK-MD-core/database/settings");
    delete require.cache[settingsPath];

    const rows = new Map();
    const model = {
        sync: async () => {},
        destroy: async () => {},
        findOne: async ({ where }) => rows.get(where.key) || null,
        findOrCreate: async ({ where, defaults }) => {
            const existing = rows.get(where.key);
            if (existing) return [existing, false];

            const record = {
                ...defaults,
                save: async () => rows.set(record.key, record),
            };
            rows.set(record.key, record);
            return [record, true];
        },
        findAll: async () => [...rows.values()],
    };
    const database = {
        define: () => model,
    };

    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === "./database" && parent?.filename === settingsPath) {
            return { DATABASE: database };
        }
        if (request === "../../config" && parent?.filename === settingsPath) {
            return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return {
            ...require(settingsPath),
            rows,
            model,
        };
    } finally {
        Module._load = originalLoad;
    }
}

async function initialize(settings) {
    await settings.initializeSettings();
}

test("concurrent reads after cache expiry share one database query", async () => {
    const settings = loadSettingsWithMockDatabase();
    await initialize(settings);

    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
        let queryCount = 0;
        let resolveQuery;
        settings.model.findAll = () => {
            queryCount += 1;
            return new Promise((resolve) => {
                resolveQuery = resolve;
            });
        };

        const initialRead = settings.getAllSettings();
        assert.equal(queryCount, 1);
        resolveQuery([{ key: "PREFIX", value: "!" }]);
        assert.equal((await initialRead).PREFIX, "!");

        now += 1001;
        const concurrentReads = Array.from({ length: 8 }, () =>
            settings.getAllSettings(),
        );
        assert.equal(queryCount, 2);

        resolveQuery([{ key: "PREFIX", value: "?" }]);
        const results = await Promise.all(concurrentReads);
        assert.equal(queryCount, 2);
        for (const result of results) {
            assert.equal(result.PREFIX, "?");
        }
    } finally {
        Date.now = originalNow;
    }
});

test("writes invalidate the settings cache", async () => {
    const settings = loadSettingsWithMockDatabase();
    await initialize(settings);

    let queryCount = 0;
    settings.model.findAll = async () => {
        queryCount += 1;
        return [...settings.rows.values()];
    };

    const cachedSettings = await settings.getAllSettings();
    assert.equal(queryCount, 1);

    await settings.setSetting("PREFIX", "!");
    const refreshedSettings = await settings.getAllSettings();

    assert.equal(queryCount, 2);
    assert.equal(cachedSettings.PREFIX, ".");
    assert.equal(refreshedSettings.PREFIX, "!");
});

test("a read already in flight cannot repopulate cache after a write", async () => {
    const settings = loadSettingsWithMockDatabase();
    await initialize(settings);

    let queryCount = 0;
    let resolveStaleQuery;
    settings.model.findAll = () => {
        queryCount += 1;
        if (queryCount === 1) {
            return new Promise((resolve) => {
                resolveStaleQuery = resolve;
            });
        }
        return Promise.resolve([...settings.rows.values()]);
    };

    const staleRead = settings.getAllSettings();
    await settings.setSetting("PREFIX", "!");

    const freshRead = await settings.getAllSettings();
    resolveStaleQuery([{ key: "PREFIX", value: "." }]);
    await staleRead;

    assert.equal(freshRead.PREFIX, "!");
    assert.equal((await settings.getAllSettings()).PREFIX, "!");
    assert.equal(queryCount, 2);
});
