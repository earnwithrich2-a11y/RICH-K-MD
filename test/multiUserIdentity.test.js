const test = require("node:test");
const assert = require("node:assert/strict");
const { connectedOwnerJid, isConnectedOwner } = require("../RICHK-MD-core/connection/ownerIdentity");
const { connectedUserJid } = require("../RICHK-MD-core/connection/messageRecovery");
const { buildSuperUsers } = require("../RICHK-MD-core/connection/commandHandler");
const { isMaintenanceOwner } = require("../RICHK-MD-core/connection/maintenance");

test("different deployments resolve their own account and device/LID identities without shared owner numbers", async () => {
    const first = { user: { id: "100:7@s.whatsapp.net", lid: "900:2@lid" } };
    const second = { user: { id: "200@s.whatsapp.net", lid: "800@lid" } };
    assert.equal(connectedOwnerJid(first), "100@s.whatsapp.net");
    assert.equal(connectedUserJid(second), "200@s.whatsapp.net");
    assert.equal(isConnectedOwner(first, "100@s.whatsapp.net"), true);
    assert.equal(isConnectedOwner(first, "900@lid"), true);
    assert.equal(isConnectedOwner(second, "100@s.whatsapp.net"), false);
    assert.equal(isConnectedOwner({}, "100@s.whatsapp.net"), false);
    assert.equal(connectedOwnerJid({ user: { id: "900@lid" } }), "");
    assert.throws(() => connectedUserJid({}), /unavailable/);
    assert.equal(connectedUserJid({ user: { id: "900@lid" },
        authState: { creds: { me: { id: "100@s.whatsapp.net" } } } }), "100@s.whatsapp.net");
    const roles = await buildSuperUsers({ SUDO_NUMBERS: "300" }, async () => ["400"],
        first.user.id, connectedOwnerJid(first).split("@")[0]);
    // Existing sudo validation requires normal-length numbers; database sudo is explicit.
    assert.deepEqual(roles.sort(), ["100@s.whatsapp.net", "400@s.whatsapp.net"]);
});

test("maintenance ignores a stale configured owner but retains explicitly approved sudo access", async () => {
    const socket = { user: { id: "200:3@s.whatsapp.net" } };
    const oldOwner = { sender: "100@s.whatsapp.net", ownerNumber: "100" };
    assert.equal(await isMaintenanceOwner(socket, oldOwner), false);
    assert.equal(await isMaintenanceOwner(socket, { ...oldOwner, getSudoNumbers: async () => ["100"] }), true);
});
