const test = require("node:test");
const assert = require("node:assert/strict");
const sdk = require("gifted-baileys");
const { repairLegacyDeviceSignature } = require("../RICHK-MD-core/connection/deviceIdentitySignature");

function fixture(legacy = true, hostedDevice = false) {
    const identity = sdk.Curve.generateKeyPair();
    const accountKey = sdk.Curve.generateKeyPair();
    const details = sdk.proto.ADVDeviceIdentity.encode(sdk.proto.ADVDeviceIdentity.fromObject({
        rawId: 1, keyIndex: 1, accountType: sdk.proto.ADVEncryptionType.HOSTED,
        deviceType: hostedDevice ? sdk.proto.ADVEncryptionType.HOSTED : sdk.proto.ADVEncryptionType.E2EE,
    })).finish();
    const accountSignature = sdk.Curve.sign(accountKey.private, Buffer.concat([
        Buffer.from(hostedDevice ? [6, 5] : [6, 0]), details, identity.public,
    ]));
    const deviceSignature = sdk.Curve.sign(identity.private, Buffer.concat([
        Buffer.from(legacy ? [6, 6] : [6, 1]), details, identity.public, accountKey.public,
    ]));
    return {
        signedIdentityKey: identity,
        me: { id: "15550000001:4@s.whatsapp.net" },
        account: {
            details: Buffer.from(details).toString("base64"),
            accountSignatureKey: accountKey.public.toString("base64"),
            accountSignature: accountSignature.toString("base64"),
            deviceSignature: deviceSignature.toString("base64"),
        },
    };
}

test("legacy hosted-account device signatures are corrected without changing the login or account certificate", () => {
    const creds = fixture();
    const before = { ...creds.account };
    const keys = Buffer.from(creds.signedIdentityKey.private);
    const me = JSON.stringify(creds.me);
    assert.equal(repairLegacyDeviceSignature(creds).repaired, true);
    assert.deepEqual(creds.signedIdentityKey.private, keys);
    assert.equal(JSON.stringify(creds.me), me);
    for (const field of ["details", "accountSignatureKey", "accountSignature"]) {
        assert.equal(creds.account[field], before[field]);
    }
    // Verify the exact device-identity bytes that Bungoma puts on the wire.
    const encoded = sdk.encodeSignedDeviceIdentity(creds.account, true);
    const account = sdk.proto.ADVSignedDeviceIdentity.decode(encoded);
    const message = Buffer.concat([Buffer.from([6, 1]), account.details, creds.signedIdentityKey.public, account.accountSignatureKey]);
    assert.equal(sdk.Curve.verify(creds.signedIdentityKey.public, message, account.deviceSignature), true);
    assert.equal(repairLegacyDeviceSignature(creds).repaired, false);
});

test("valid device certificates are unchanged, including hosted-device account signatures", () => {
    for (const hosted of [false, true]) {
        const creds = fixture(false, hosted);
        const before = JSON.stringify(creds.account);
        assert.equal(repairLegacyDeviceSignature(creds).repaired, false);
        assert.equal(JSON.stringify(creds.account), before);
    }
});

test("an invalid account certificate cannot authorize device-signature repair", () => {
    const creds = fixture();
    const tampered = Buffer.from(creds.account.accountSignature, "base64");
    tampered[0] ^= 1;
    creds.account.accountSignature = tampered.toString("base64");
    const before = JSON.stringify(creds.account);
    assert.throws(() => repairLegacyDeviceSignature(creds), /Account certificate verification failed/);
    assert.equal(JSON.stringify(creds.account), before);
});

test("unknown invalid device signatures and mismatched private keys fail without modifying the login", () => {
    const creds = fixture();
    creds.signedIdentityKey.private = sdk.Curve.generateKeyPair().private;
    const before = JSON.stringify(creds.account);
    assert.throws(() => repairLegacyDeviceSignature(creds), /signing key mismatch/);
    assert.equal(JSON.stringify(creds.account), before);
    creds.signedIdentityKey.private = sdk.Curve.generateKeyPair().private;
    creds.account.deviceSignature = Buffer.alloc(64).toString("base64");
    assert.throws(() => repairLegacyDeviceSignature(creds), /Unrecognized device/);
});
