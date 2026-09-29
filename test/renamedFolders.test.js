const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { copyFolderSync } = require("../RICHK-MD-core/copyFolderSync");

test("update copies new source paths without overwriting nested local data", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "richk-md-update-"));
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    const core = path.join(source, "RICHK-MD-core");

    try {
        fs.mkdirSync(path.join(core, "session"), { recursive: true });
        fs.mkdirSync(path.join(core, "database"), { recursive: true });
        fs.writeFileSync(path.join(core, "index.js"), "updated source");
        fs.writeFileSync(path.join(core, "session", "session.db"), "remote session");
        fs.writeFileSync(path.join(core, "session", "store.db-wal"), "remote wal");
        fs.writeFileSync(path.join(core, "database", "database.db"), "remote db");
        fs.writeFileSync(path.join(core, "database", "database.db-wal"), "remote wal");
        fs.writeFileSync(path.join(source, ".env"), "remote env");

        fs.mkdirSync(path.join(destination, "RICHK-MD-core", "session"), { recursive: true });
        fs.mkdirSync(path.join(destination, "RICHK-MD-core", "database"), { recursive: true });
        fs.writeFileSync(path.join(destination, "RICHK-MD-core", "session", "session.db"), "local session");
        fs.writeFileSync(path.join(destination, "RICHK-MD-core", "database", "database.db"), "local db");
        fs.writeFileSync(path.join(destination, "RICHK-MD-core", "database", "database.db-wal"), "local wal");

        copyFolderSync(source, destination, [
            ".env",
            "RICHK-MD-core/session",
            "RICHK-MD-core/database/database.db",
            "RICHK-MD-core/database/database.db-wal",
            "RICHK-MD-core/database/database.db-shm",
        ]);

        assert.equal(fs.readFileSync(path.join(destination, "RICHK-MD-core", "index.js"), "utf8"), "updated source");
        assert.equal(fs.readFileSync(path.join(destination, "RICHK-MD-core", "session", "session.db"), "utf8"), "local session");
        assert.equal(fs.readFileSync(path.join(destination, "RICHK-MD-core", "database", "database.db"), "utf8"), "local db");
        assert.equal(fs.readFileSync(path.join(destination, "RICHK-MD-core", "database", "database.db-wal"), "utf8"), "local wal");
        assert.equal(fs.existsSync(path.join(destination, "RICHK-MD-core", "session", "store.db-wal")), false);
        assert.equal(fs.existsSync(path.join(destination, ".env")), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});