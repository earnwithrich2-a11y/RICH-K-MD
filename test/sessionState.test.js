const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { hasStoredCredentials } = require("../RICHK-MD-core/sessionState");
const { loadPlugins } = require("../RICHK-MD-core/connection/commandHandler");

test("existing session credentials and keys are recognized without changing them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "richk-session-"));
    const file = path.join(dir, "session.db");
    try {
        assert.equal(hasStoredCredentials(file), false);
        const db = new Database(file);
        db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, value TEXT)");
        db.prepare("INSERT INTO session (id, value) VALUES (?, ?)").run("pre-key-test", "test-key");
        db.close();
        assert.equal(hasStoredCredentials(file), false);

        const populated = new Database(file);
        populated.prepare("INSERT INTO session (id, value) VALUES (?, ?)").run("creds", "test-creds");
        populated.close();
        assert.equal(hasStoredCredentials(file), true);

        const preserved = new Database(file, { readonly: true });
        assert.equal(preserved.prepare("SELECT value FROM session WHERE id = ?").get("pre-key-test").value, "test-key");
        assert.equal(preserved.prepare("SELECT value FROM session WHERE id = ?").get("creds").value, "test-creds");
        preserved.close();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("startup plugin validation reports command module failures", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "richk-plugin-"));
    try {
        fs.writeFileSync(path.join(dir, "broken.js"), "throw new Error('module failed');");
        assert.throws(
            () => loadPlugins(dir, { throwOnError: true }),
            /Failed to load broken\.js: module failed/,
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});