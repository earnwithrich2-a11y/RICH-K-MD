const { makeLibSignalRepository } = require("gifted-baileys/lib/Signal/libsignal");
const { createTransportLogger } = require("./transportLogger");

// Session initialization, decryption and sender-key changes must participate
// in the same commit boundary as encryption. Signal's per-address mutex alone
// does not protect a session whose outer key-store transaction is uncommitted.
function makeAtomicSignalRepository(auth) {
    // Upstream provides native per-session transactions, domain-aware
    // addresses and PN/LID migration. Do not wrap it in a global relay lock.
    return makeLibSignalRepository(auth, createTransportLogger());
}

module.exports = { makeAtomicSignalRepository };
