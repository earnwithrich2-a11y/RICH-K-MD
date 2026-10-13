const { makeLibSignalRepository } = require("gifted-baileys/lib/Signal/libsignal");
const { createTransportLogger } = require("./transportLogger");

// Session initialization, decryption and sender-key changes must participate
// in the same commit boundary as encryption. Signal's per-address mutex alone
// does not protect a session whose outer key-store transaction is uncommitted.
function makeAtomicSignalRepository(auth, logger, pnToLid) {
    const log = createTransportLogger();
    const repository = makeLibSignalRepository(auth, log, pnToLid);
    const { jidDecode } = require("gifted-baileys");
    const canonical = async jid => {
        if (jid?.endsWith("@s.whatsapp.net")) {
            return await repository.lidMapping.getLIDForPN(jid) || jid;
        }
        return jid;
    };
    for (const method of [
        "encryptMessage", "decryptMessage", "injectE2ESession",
        "encryptGroupMessage", "decryptGroupMessage", "processSenderKeyDistributionMessage",
    ]) {
        const operation = repository[method].bind(repository);
        repository[method] = async args => {
            const group = args.group || args.item?.groupId;
            const jid = await canonical(args.jid || args.authorJid || args.meId);
            const address = repository.jidToSignalProtocolAddress(jid);
            const normalized = { ...args };
            for (const name of ["jid", "authorJid", "meId"]) {
                if (args[name]) normalized[name] = jid;
            }
            return auth.keys.transaction(() => operation(normalized), `${group || ""}:${address}`);
        };
    }
    repository.validateSession = async jid => {
        const address = repository.jidToSignalProtocolAddress(await canonical(jid));
        const record = (await auth.keys.get("session", [address]))[address];
        if (!record) return { exists: false };
        try {
            return { exists: require("libsignal").SessionRecord.deserialize(record).haveOpenSession() };
        } catch { return { exists: false }; }
    };
    repository.migrateSession = async (pn, lid) => {
        const user = jidDecode(pn).user;
        const devices = (await auth.keys.get("device-list", [user]))[user] || ["0"];
        let migrated = 0;
        for (const device of devices) {
            const source = repository.jidToSignalProtocolAddress(`${user}:${device}@s.whatsapp.net`);
            const destination = repository.jidToSignalProtocolAddress(`${jidDecode(lid).user}:${device}@lid`);
            await auth.keys.transaction(async () => {
                const data = await auth.keys.get("session", [source, destination]);
                if (!data[destination] && data[source]) {
                    await auth.keys.set({ session: { [destination]: data[source] } });
                    migrated++;
                }
            }, `:${destination}`);
        }
        return { migrated };
    };
    return repository;
}

module.exports = { makeAtomicSignalRepository };
