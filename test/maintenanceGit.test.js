const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const { createMaintenanceService, TEXT } = require("../RICHK-MD-core/connection/maintenance");

test("real fast-forward update preserves an existing auth directory byte-for-byte", async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maintenance-git-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const origin = path.join(dir, "origin.git"), seed = path.join(dir, "seed"), bot = path.join(dir, "bot");
    fs.mkdirSync(seed);
    const env = { ...process.env, DANGEROUSLY_ALLOW_GIT: "1", GIT_TERMINAL_PROMPT: "0" };
    for (const key of Object.keys(env)) if (key.startsWith("GIT_TRACE") || key === "GIT_CURL_VERBOSE") delete env[key];
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, stdio: "pipe" }).toString().trim();
    git(dir, "init", "--bare", "--initial-branch=main", origin);
    git(seed, "init", "-b", "main");
    git(seed, "config", "user.name", "Maintenance Test");
    git(seed, "config", "user.email", "maintenance@example.invalid");
    fs.writeFileSync(path.join(seed, "package.json"), JSON.stringify({ name: "fixture", dependencies: {} }));
    fs.writeFileSync(path.join(seed, ".gitignore"), "RICHK-MD-core/session/\n");
    fs.writeFileSync(path.join(seed, "index.js"), "// old code\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "initial");
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "origin", "main");
    git(dir, "clone", origin, bot);
    const auth = path.join(bot, "RICHK-MD-core/session");
    fs.mkdirSync(auth, { recursive: true });
    const bytes = Buffer.from("synthetic existing auth state");
    for (const name of ["creds.json", "session.db", "session.db-wal"]) fs.writeFileSync(path.join(auth, name), bytes);
    fs.writeFileSync(path.join(seed, "index.js"), "// new code\n");
    git(seed, "add", "index.js");
    git(seed, "commit", "-m", "new code");
    git(seed, "push", "origin", "main");
    const replies = [], exits = [], calls = [];
    const execute = promisify(execFile);
    const service = createMaintenanceService({
        cwd: bot,
        run: async (file, args, options) => { calls.push([file, args]); return execute(file, args, options); },
        delay: async () => {},
        exit: code => exits.push(code),
    });
    let saved = false, closed = false;
    await service.run("update", {
        user: { id: "15550000001:7@s.whatsapp.net" },
        prepareForMaintenanceRestart: async () => { saved = true; },
        end: async () => { assert.equal(saved, true); closed = true; },
        logout: () => { throw Error("must never revoke login"); },
    }, {
        m: { key: { fromMe: true } },
        reply: async text => replies.push(text),
    });
    assert.deepEqual(replies, [TEXT.checking, TEXT.updating]);
    assert.deepEqual(exits, [0]);
    assert.equal(closed, true);
    assert.equal(fs.readFileSync(path.join(bot, "index.js"), "utf8"), "// new code\n");
    assert.equal(git(bot, "rev-parse", "HEAD"), git(seed, "rev-parse", "HEAD"));
    for (const name of ["creds.json", "session.db", "session.db-wal"]) {
        assert.deepEqual(fs.readFileSync(path.join(auth, name)), bytes);
    }
    assert.equal(calls.some(([file]) => file === "npm"), false);
    assert.equal(git(bot, "status", "--porcelain"), "");
});
