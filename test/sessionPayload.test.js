const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { decodeSessionCredentials } = require("../RICHK-MD-core/connection/sessionPayload");

const credentials = {
    me: { id: "123@s.whatsapp.net" },
    noiseKey: { private: { type: "Buffer", data: [1] } },
    signedIdentityKey: { private: { type: "Buffer", data: [2] } },
    signedPreKey: { keyPair: { private: { type: "Buffer", data: [3] } } },
};
const encoded = zlib.gzipSync(JSON.stringify(credentials)).toString("base64");

test("imports synthetic XMD and existing Gifted session formats", () => {
    for (const session of [
        `XMDI${encoded.slice(4)}`,
        `XMDs${encoded.slice(4)}`,
        `XMD${encoded.slice(3)}`,
        `BWM-XMD;;;${encoded}`,
        `Gifted~${encoded}`,
    ]) {
        assert.deepEqual(JSON.parse(decodeSessionCredentials(session).toString()), credentials);
    }
});

test("rejects invalid sessions before they can be imported", () => {
    for (const session of [
        "XMDIinvalid",
        "XMDI",
        "Gifted~not-compressed",
        "BWM-XMD;;;invalid",
        "unknown",
        `XMDI${zlib.gzipSync("not json").toString("base64").slice(4)}`,
        `XMDI${zlib.gzipSync('{"me":{"id":"123@s.whatsapp.net"}}').toString("base64").slice(4)}`,
    ]) {
        assert.throws(() => decodeSessionCredentials(session));
    }
});

test("limits inflated session size", () => {
    const oversized = zlib.gzipSync(" ".repeat(8 * 1024 * 1024 + 1)).toString("base64");
    assert.throws(() => decodeSessionCredentials(`XMDI${oversized.slice(4)}`), /decompress/);
});