const { makeLibSignalRepository } = require("gifted-baileys/lib/Signal/libsignal");

// Session initialization, decryption and sender-key changes must participate
// in the same commit boundary as encryption. Signal's per-address mutex alone
// does not protect a session whose outer key-store transaction is uncommitted.
function makeAtomicSignalRepository(auth) {
    const repository = makeLibSignalRepository(auth);
    for (const method of [
        "encryptMessage", "decryptMessage", "injectE2ESession",
        "encryptGroupMessage", "decryptGroupMessage", "processSenderKeyDistributionMessage",
    ]) {
        const operation = repository[method].bind(repository);
        repository[method] = args => auth.keys.transaction(() => operation(args));
    }
    return repository;
}

module.exports = { makeAtomicSignalRepository };
