const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makePortable } = require("../scripts/portable-lockfile");
const manifest = require("../package.json");
const lock = require("../package-lock.json");

test("Heroku major versions, Git allowance and peer dependency policy are explicit", () => {
    assert.deepEqual(manifest.engines, { node: "20.x", npm: "10.x" });
    const config = fs.readFileSync(path.join(__dirname, "../.npmrc"), "utf8");
    assert.match(config, /^allow-git=true$/m);
    assert.match(config, /^legacy-peer-deps=true$/m);
    assert.match(config, /^save-exact=true$/m);
});

test("portable lock agrees with package.json and pins the supported patched SDK", () => {
    assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
    assert.deepEqual(lock.packages[""].engines, manifest.engines);
    assert.equal(manifest.dependencies["@whiskeysockets/baileys"], "7.0.0-rc14");
    assert.equal(lock.packages["node_modules/@whiskeysockets/baileys"].version, "7.0.0-rc14");
    assert.equal(require("@whiskeysockets/baileys/package.json").name, "@whiskeysockets/baileys");
    for (const [name, version] of Object.entries(manifest.dependencies)) {
        assert.match(version, /^(?:\d+\.\d+\.\d+(?:-[\w.-]+)?|file:)/, `${name} must be pinned`);
        if (!version.startsWith("file:")) assert.equal(lock.packages[`node_modules/${name}`].version, version);
    }
    for (const [name, entry] of Object.entries(lock.packages)) {
        assert.ok(!entry.resolved?.includes(".internal"), `${name} must be installable outside Replit`);
    }
});

test("worker and Docker launch the restart supervisor and install copied local packages", () => {
    const root = path.join(__dirname, "..");
    assert.match(fs.readFileSync(path.join(root, "Procfile"), "utf8"), /^worker: npm start$/m);
    assert.deepEqual(require("../app.json").formation, { worker: { quantity: 1, size: "basic" } });
    const docker = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
    assert.ok(docker.indexOf("COPY . .") < docker.indexOf("RUN npm ci --omit=dev"));
    assert.match(fs.readFileSync(path.join(root, ".dockerignore"), "utf8"), /RICHK-MD-core\/session/);
    assert.equal(manifest.scripts.start, "node scripts/run-bot.js");
    assert.match(docker, /CMD \["npm", "start"\]/);
    assert.match(fs.readFileSync(path.join(root, "scripts/run-bot.js"), "utf8"), /\["index\.js"\]/);
});
test("registry normalization preserves package versions, integrity hashes and unrelated URLs", () => {
    const proxy = {
        version: "1.2.3", integrity: "sha512-test",
        resolved: "http://package-firewall.replit.internal/npm/@scope/example/-/example-1.2.3.tgz",
    };
    const publicEntry = { version: "2.0.0", resolved: "https://registry.npmjs.org/other/-/other-2.0.0.tgz" };
    const gitEntry = { resolved: "git+https://github.com/example/package.git#fixed" };
    const fixture = { packages: { "node_modules/example": proxy, publicEntry, gitEntry, local: { link: true } } };
    assert.equal(makePortable(fixture), 1);
    assert.equal(proxy.resolved, "https://registry.npmjs.org/@scope/example/-/example-1.2.3.tgz");
    assert.equal(proxy.version, "1.2.3");
    assert.equal(proxy.integrity, "sha512-test");
    assert.equal(publicEntry.resolved, "https://registry.npmjs.org/other/-/other-2.0.0.tgz");
    assert.equal(gitEntry.resolved, "git+https://github.com/example/package.git#fixed");
    assert.equal(makePortable(fixture), 0);
    assert.equal(makePortable(fixture, true), 2);
    assert.equal(proxy.resolved, "http://package-firewall.replit.internal/npm/@scope/example/-/example-1.2.3.tgz");
    assert.equal(makePortable(fixture), 2);
    assert.equal(proxy.integrity, "sha512-test");
});
