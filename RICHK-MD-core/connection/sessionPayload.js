const zlib = require("node:zlib");

const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_CREDENTIAL_BYTES = 8 * 1024 * 1024;

function decodeSessionCredentials(sessionId) {
    if (typeof sessionId !== "string") {
        throw new Error("Invalid session ID");
    }

    const session = sessionId.trim();
    let base64;
    if (session.startsWith("XMDI") || session.startsWith("XMDs")) {
        base64 = `H4sI${session.slice(4)}`;
    } else if (session.startsWith("XMD")) {
        base64 = `H4s${session.slice(3)}`;
    } else if (session.startsWith("BWM-XMD;;;")) {
        base64 = session.slice("BWM-XMD;;;".length).replace("...", "");
    } else if (session.startsWith("Gifted~")) {
        base64 = session.slice("Gifted~".length).replace("...", "");
    } else {
        throw new Error("Invalid session format. Expected Gifted, XMD or BWM-XMD");
    }

    if (
        !base64 ||
        base64.length > Math.ceil(MAX_COMPRESSED_BYTES * 4 / 3) + 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) ||
        base64.length % 4 === 1
    ) {
        throw new Error("Invalid session data");
    }

    const compressed = Buffer.from(base64, "base64");
    if (
        compressed.length > MAX_COMPRESSED_BYTES ||
        compressed[0] !== 0x1f ||
        compressed[1] !== 0x8b
    ) {
        throw new Error("Invalid session data");
    }

    let decoded;
    try {
        decoded = zlib.gunzipSync(compressed, { maxOutputLength: MAX_CREDENTIAL_BYTES });
    } catch {
        throw new Error("Could not decompress session data");
    }

    let credentials;
    try {
        credentials = JSON.parse(decoded.toString("utf8"));
    } catch {
        throw new Error("Session does not contain valid credentials");
    }
    if (
        !credentials ||
        Array.isArray(credentials) ||
        typeof credentials.me?.id !== "string" ||
        !credentials.noiseKey ||
        !credentials.signedIdentityKey ||
        !credentials.signedPreKey
    ) {
        throw new Error("Session does not contain usable WhatsApp credentials");
    }
    return decoded;
}

module.exports = { decodeSessionCredentials };