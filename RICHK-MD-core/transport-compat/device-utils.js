const sdk = require("@whiskeysockets/baileys");

function extractDeviceJids(result, myJid, third, fourth) {
    // Older plugins passed the exclude-zero flag before the sender's LID.
    return typeof third === "boolean"
        ? sdk.extractDeviceJids(result, myJid, fourth, third)
        : sdk.extractDeviceJids(result, myJid, third, fourth);
}

module.exports = { extractDeviceJids };
