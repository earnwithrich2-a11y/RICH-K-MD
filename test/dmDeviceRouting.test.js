const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { extractDeviceJids } = require("gifted-baileys/lib/Utils/signal");
const WABinary = require("gifted-baileys/lib/WABinary");

const source = fs.readFileSync(require.resolve("gifted-baileys/lib/Socket/messages-send"), "utf8");
const meId = "15550000001:4@s.whatsapp.net";
const meLid = "99880001:4@lid";

function route(devices, isLid) {
    const start = source.indexOf("const allJids = [];");
    const end = source.indexOf("await assertSessions(allJids, false);", start);
    assert.ok(start >= 0 && end > start);
    const run = new Function("WABinary_1", "devices", "isLid", "meId", "meLid", `
        const meUser = "15550000001", mePhone = meUser, meLidUser = "99880001";
        ${source.slice(start, end)}
        return { allJids, meJids, otherJids };
    `);
    return run(WABinary, devices, isLid, meId, meLid);
}

test("device discovery retains each recipient namespace and excludes both sender aliases", () => {
    const devices = extractDeviceJids([
        { id: "15550000001@s.whatsapp.net", devices: { deviceList: [{ id: 4, keyIndex: 1 }, { id: 0 }] } },
        { id: "99880001@lid", devices: { deviceList: [{ id: 4, keyIndex: 1 }, { id: 0 }] } },
        { id: "15550000002@s.whatsapp.net", devices: { deviceList: [{ id: 2, keyIndex: 1 }] } },
        { id: "99880002@lid", devices: { deviceList: [{ id: 1, keyIndex: 1 }] } },
    ], meId, true, meLid);
    assert.deepEqual(devices, [
        { user: "15550000002", device: 2, server: "s.whatsapp.net" },
        { user: "99880002", device: 1, server: "lid" },
    ]);
});

test("a LID chat does not turn a discovered phone address into a LID", () => {
    const result = route([
        { user: "99880002" },
        { user: "15550000002", device: 2, server: "s.whatsapp.net" },
        { user: "15550000001", device: 2, server: "s.whatsapp.net" },
    ], true);
    assert.deepEqual(result.otherJids, ["99880002@lid", "15550000002:2@s.whatsapp.net"]);
    assert.deepEqual(result.meJids, ["15550000001:2@s.whatsapp.net"]);
});

test("a phone chat preserves a LID retry recipient", () => {
    assert.deepEqual(route([
        { user: "99880002", device: 2, server: "lid" },
    ], false).otherJids, ["99880002:2@lid"]);
});

test("recipient lists remove repeated devices and exclude the currently sending device", () => {
    const result = route([
        { user: "15550000001", device: 4, server: "s.whatsapp.net" },
        { user: "99880001", device: 4, server: "lid" },
        { user: "99880002" },
        { user: "99880002", device: 0, server: "lid" },
        { user: "99880002", device: 2, server: "lid" },
        { user: "99880002", device: 2, server: "lid" },
    ], true);
    assert.deepEqual(result.allJids, ["99880002@lid", "99880002:2@lid"]);
});

test("cached device lists still respect primary-device exclusion", async () => {
    const start = source.indexOf("const getUSyncDevices = async");
    const end = source.indexOf("const assertSessions = async", start);
    const create = new Function("WABinary_1", "userDevicesCache", "logger", `
        ${source.slice(start, end)} return getUSyncDevices;
    `);
    const getDevices = create(WABinary, {
        get() { return [{ user: "99880002", device: 0, server: "lid" }, { user: "99880002", device: 2, server: "lid" }]; },
    }, { trace() {}, debug() {} });
    assert.deepEqual(await getDevices(["99880002@lid"], true, true), [
        { user: "99880002", device: 2, server: "lid" },
    ]);
});

test("targeted retries include device identity even when the cipher returns a regular message", () => {
    assert.match(source, /let shouldIncludeDeviceIdentity = !!participant;/);
    assert.match(source, /const \{ user, device, server \} = .*participant\.jid/);
    assert.match(source, /jidDecode\)\(meLid\)\.user/);
});
