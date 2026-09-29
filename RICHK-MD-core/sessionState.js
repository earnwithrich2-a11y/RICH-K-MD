const fs = require("fs");
const Database = require("better-sqlite3");

function hasStoredCredentials(dbPath) {
    if (!fs.existsSync(dbPath)) return false;

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        const table = db.prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session'",
        ).get();
        if (!table) return false;

        return Boolean(db.prepare("SELECT 1 FROM session WHERE id = ?").get("creds"));
    } finally {
        db.close();
    }
}

module.exports = { hasStoredCredentials };