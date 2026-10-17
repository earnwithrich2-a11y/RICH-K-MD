const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { REQUIRED_PATCHES, missingTransportPatches } =
    require("../scripts/ensure-transport-patches");

test("startup refuses to silently skip missing WhatsApp fixes", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "transport-patches-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(missingTransportPatches(root), REQUIRED_PATCHES);
    const result = spawnSync(process.execPath, [
        path.join(__dirname, "../scripts/ensure-transport-patches.js"), root,
    ], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Required WhatsApp fixes are missing/);
});

test("all required fixes must be present and nonempty", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "transport-patches-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, "patches"));
    fs.writeFileSync(path.join(root, "patches", REQUIRED_PATCHES[0]), "fixture");
    fs.writeFileSync(path.join(root, "patches", REQUIRED_PATCHES[1]), "");
    assert.deepEqual(missingTransportPatches(root), [REQUIRED_PATCHES[1]]);
    fs.writeFileSync(path.join(root, "patches", REQUIRED_PATCHES[1]), "fixture");
    assert.deepEqual(missingTransportPatches(root), []);
});
