const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'session', 'store.db');

function safeStringify(obj) {
    return JSON.stringify(obj, function (key, value) {
        // Buffer.toJSON runs before the replacer, so inspect the original value.
        const original = key ? this[key] : value;
        if (original instanceof Uint8Array || Buffer.isBuffer(original)) {
            return { __type: 'Buffer', data: Buffer.from(original).toString('base64') };
        }
        return value;
    });
}

function safeParse(str) {
    return JSON.parse(str, (_, v) => {
        if (v && typeof v === 'object') {
            if (v.__type === 'Buffer' && typeof v.data === 'string') {
                return Buffer.from(v.data, 'base64');
            }
            // Messages saved before Buffer.toJSON was handled use Node's shape.
            if (v.type === 'Buffer' && Array.isArray(v.data)) {
                return Buffer.from(v.data);
            }
        }
        return v;
    });
}

let _db = null;
let _stmts = {};

function getDb() {
    if (_db) return _db;
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('cache_size = -10000');
    _db.pragma('temp_store = memory');
    _db.exec(`
        CREATE TABLE IF NOT EXISTS msg_store (
            id      TEXT NOT NULL,
            jid     TEXT NOT NULL,
            data    TEXT NOT NULL,
            ts      INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (jid, id)
        );
        CREATE INDEX IF NOT EXISTS idx_msg_ts ON msg_store(ts);
        CREATE INDEX IF NOT EXISTS idx_msg_id ON msg_store(id);

        CREATE TABLE IF NOT EXISTS antidelete_store (
            id          TEXT NOT NULL,
            jid         TEXT NOT NULL,
            sender      TEXT,
            push_name   TEXT,
            data        TEXT NOT NULL,
            ts          INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (jid, id)
        );
        CREATE INDEX IF NOT EXISTS idx_ad_jid_ts ON antidelete_store(jid, ts);

        CREATE TRIGGER IF NOT EXISTS trim_msg_store AFTER INSERT ON msg_store
        BEGIN
            DELETE FROM msg_store WHERE jid = NEW.jid AND id NOT IN (
                SELECT id FROM msg_store WHERE jid = NEW.jid ORDER BY ts DESC LIMIT 200
            );
        END;

        CREATE TRIGGER IF NOT EXISTS trim_antidelete AFTER INSERT ON antidelete_store
        BEGIN
            DELETE FROM antidelete_store WHERE jid = NEW.jid AND id NOT IN (
                SELECT id FROM antidelete_store WHERE jid = NEW.jid ORDER BY ts DESC LIMIT 100
            );
        END;
    `);

    _stmts.saveMsg    = _db.prepare('INSERT OR REPLACE INTO msg_store (id, jid, data, ts) VALUES (?, ?, ?, unixepoch())');
    _stmts.loadMsg    = _db.prepare('SELECT data FROM msg_store WHERE jid = ? AND id = ?');
    _stmts.loadMsgById = _db.prepare('SELECT data FROM msg_store WHERE id = ? ORDER BY ts DESC LIMIT 1');
    _stmts.saveAD     = _db.prepare('INSERT OR REPLACE INTO antidelete_store (id, jid, sender, push_name, data, ts) VALUES (?, ?, ?, ?, ?, unixepoch())');
    _stmts.findAD     = _db.prepare('SELECT jid, data FROM antidelete_store WHERE jid = ? AND id = ?');
    _stmts.findADById = _db.prepare('SELECT jid, data FROM antidelete_store WHERE id = ? ORDER BY ts DESC LIMIT 1');
    _stmts.delAD      = _db.prepare('DELETE FROM antidelete_store WHERE jid = ? AND id = ?');
    _stmts.cleanAD    = _db.prepare('DELETE FROM antidelete_store WHERE ts < unixepoch() - 86400');
    _stmts.cleanMsg   = _db.prepare('DELETE FROM msg_store WHERE ts < unixepoch() - 604800');

    return _db;
}

function s(sql) {
    if (!_stmts[sql]) _stmts[sql] = getDb().prepare(sql);
    return _stmts[sql];
}

function saveMsg(jid, message) {
    try {
        getDb();
        _stmts.saveMsg.run(message.key.id, jid, safeStringify(message));
    } catch (e) {
        console.error('[msgStore] save:', e.message);
    }
}

function loadMsg(jid, id) {
    try {
        getDb();
        const row = _stmts.loadMsg.get(jid, id);
        return row ? safeParse(row.data) : null;
    } catch (e) {
        return null;
    }
}

function loadMsgById(id) {
    try {
        getDb();
        const row = _stmts.loadMsgById.get(id);
        return row ? safeParse(row.data) : null;
    } catch (e) {
        return null;
    }
}

function saveAntiDelete(jid, message) {
    try {
        getDb();
        _stmts.saveAD.run(
            message.key.id,
            jid,
            message.originalSender || null,
            message.originalPushName || null,
            safeStringify(message)
        );
    } catch (e) {
        console.error('[antiDeleteStore] save:', e.message);
    }
}

function findAntiDelete(jid, id) {
    try {
        getDb();
        const row = _stmts.findAD.get(jid, id) || _stmts.findADById.get(id);
        if (!row) return null;
        const message = safeParse(row.data);
        message._antiDeleteStoredJid = row.jid;
        return message;
    } catch (e) {
        return null;
    }
}

function removeAntiDelete(jid, id) {
    try {
        getDb();
        _stmts.delAD.run(jid, id);
    } catch (e) {}
}

function startCleanup() {
    setInterval(() => {
        try {
            getDb();
            _stmts.cleanAD.run();
            _stmts.cleanMsg.run();
        } catch (e) {}
    }, 300000);
}

class SQLiteStore {
    constructor() {
        getDb();
    }

    loadMessage(jid, id) {
        return loadMsg(jid, id);
    }

    loadMessageById(id) {
        return loadMsgById(id);
    }

    saveMessage(jid, message) {
        saveMsg(jid, message);
    }

    bind(ev) {
        this.destroy();
        this._eventSource = ev;
        this._handler = ({ messages = [] }) => {
            const incoming = [];
            for (const msg of messages) {
                if (!msg.key?.remoteJid || !msg.key?.id) continue;
                if (msg.key.fromMe) {
                    this.saveMessage(msg.key.remoteJid, msg);
                } else {
                    incoming.push(msg);
                }
            }
            if (incoming.length) {
                setImmediate(() => {
                    for (const msg of incoming) {
                        this.saveMessage(msg.key.remoteJid, msg);
                    }
                });
            }
        };
        ev.on('messages.upsert', this._handler);
    }

    destroy() {
        if (this._eventSource && this._handler) {
            this._eventSource.off('messages.upsert', this._handler);
        }
        this._eventSource = null;
        this._handler = null;
    }
}

module.exports = {
    saveMsg,
    loadMsg,
    saveAntiDelete,
    findAntiDelete,
    removeAntiDelete,
    startCleanup,
    SQLiteStore,
};
