// CommonJS plugins share the supported upstream SDK and protected key store.
const sdk = require("@whiskeysockets/baileys");
const protectedKeys = require("../connection/signalKeyTransactions");
const { extractE2ESessionFromRetryReceipt } = require("../connection/retryReceiptBundle");
const verify = (publicKey, message, signature) => {
    try {
        return require("libsignal").curve.verifySignature(
            sdk.generateSignalPubKey(publicKey), message, signature,
        ) !== false;
    } catch { return false; }
};
module.exports = {
    ...sdk,
    ...protectedKeys,
    Curve: { ...sdk.Curve, verify },
    extractE2ESessionFromRetryReceipt,
    extractDeviceJids: require("./device-utils").extractDeviceJids,
};
