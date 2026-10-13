function extractE2ESessionFromRetryReceipt(receipt) {
    const sdk = require("@whiskeysockets/baileys");
    const child = sdk.getBinaryNodeChild;
    const keys = child(receipt, "keys");
    if (!keys) return undefined;
    const bytes = (parent, tag, length) => {
        const value = child(parent, tag)?.content;
        if (!(value instanceof Uint8Array) || value.length !== length) {
            throw new Error("Invalid retry key bundle");
        }
        return Buffer.from(value);
    };
    const signed = child(keys, "skey");
    if (!signed || bytes(keys, "type", 1)[0] !== 5) throw new Error("Invalid retry key bundle");
    const signedId = bytes(signed, "id", 3);
    const bundle = {
        registrationId: bytes(receipt, "registration", 4).readUInt32BE(0),
        identityKey: sdk.generateSignalPubKey(bytes(keys, "identity", 32)),
        signedPreKey: {
            keyId: signedId.readUIntBE(0, 3),
            publicKey: sdk.generateSignalPubKey(bytes(signed, "value", 32)),
            signature: bytes(signed, "signature", 64),
        },
    };
    const prekey = child(keys, "key");
    if (prekey) bundle.preKey = {
        keyId: bytes(prekey, "id", 3).readUIntBE(0, 3),
        publicKey: sdk.generateSignalPubKey(bytes(prekey, "value", 32)),
    };
    return bundle;
}

module.exports = { extractE2ESessionFromRetryReceipt };
