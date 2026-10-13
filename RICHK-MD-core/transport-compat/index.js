// Legacy plugin imports remain compatible; every socket uses bungoma.
const sdk = require("@whiskeysockets/baileys");
const auth = require("@whiskeysockets/baileys/lib/Utils/auth-utils");
const utils = require("@whiskeysockets/baileys/lib/Utils");
const protectedKeys = require("../connection/signalKeyTransactions");
const { extractE2ESessionFromRetryReceipt } = require("../connection/retryReceiptBundle");
auth.addTransactionCapability = protectedKeys.addTransactionCapability;
auth.makeCacheableSignalKeyStore = protectedKeys.makeCacheableSignalKeyStore;
utils.makeCacheableSignalKeyStore = protectedKeys.makeCacheableSignalKeyStore;
utils.extractE2ESessionFromRetryReceipt = extractE2ESessionFromRetryReceipt;
sdk.makeCacheableSignalKeyStore = protectedKeys.makeCacheableSignalKeyStore;
sdk.extractE2ESessionFromRetryReceipt = extractE2ESessionFromRetryReceipt;
sdk.Curve.verify = (publicKey, message, signature) => {
    try {
        return require("libsignal").curve.verifySignature(
            sdk.generateSignalPubKey(publicKey), message, signature,
        ) !== false;
    } catch { return false; }
};
module.exports = sdk;
