const { Curve, proto } = require("gifted-baileys");

// The account/HMAC prefix and linked-device signing prefix are different.
// An account can be hosted while its linked device is ordinary E2EE.
function repairLegacyDeviceSignature(creds) {
    if (!creds.account) return { repaired: false };
    const account = proto.ADVSignedDeviceIdentity.fromObject(creds.account);
    const identity = creds.signedIdentityKey;
    const details = proto.ADVDeviceIdentity.decode(account.details);
    const accountPrefix = details.deviceType === proto.ADVEncryptionType.HOSTED
        ? Buffer.from([6, 5]) : Buffer.from([6, 0]);
    const accountMessage = Buffer.concat([accountPrefix, account.details, identity.public]);
    if (!Curve.verify(account.accountSignatureKey, accountMessage, account.accountSignature)) {
        throw new Error("Account certificate verification failed; login preserved");
    }
    const deviceMessage = Buffer.concat([
        Buffer.from([6, 1]), account.details, identity.public, account.accountSignatureKey,
    ]);
    if (Curve.verify(identity.public, deviceMessage, account.deviceSignature)) {
        return { repaired: false };
    }
    const legacyMessage = Buffer.concat([
        Buffer.from([6, 6]), account.details, identity.public, account.accountSignatureKey,
    ]);
    if (!Curve.verify(identity.public, legacyMessage, account.deviceSignature)) {
        throw new Error("Unrecognized device certificate signature; login preserved");
    }
    const signature = Curve.sign(identity.private, deviceMessage);
    if (!Curve.verify(identity.public, deviceMessage, signature)) {
        throw new Error("Device certificate signing key mismatch; login preserved");
    }
    creds.account.deviceSignature = typeof creds.account.deviceSignature === "string"
        ? signature.toString("base64") : signature;
    return { repaired: true };
}

module.exports = { repairLegacyDeviceSignature };
