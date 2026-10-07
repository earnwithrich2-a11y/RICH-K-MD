const { standardizeJid } = require("./serializer");
const { getBinaryNodeChild } = require("gifted-baileys/lib/WABinary");
const { extractE2ESessionFromRetryReceipt } = require("gifted-baileys/lib/Utils");

if (typeof extractE2ESessionFromRetryReceipt !== "function") {
    throw new Error("WhatsApp retry fix is missing. Run npm run postinstall before starting the bot.");
}

function trackSelfChatDelivery(socket, log = console.info) {
    if (!socket.ws?.on) return () => {};
    const onReceipt = (node) => {
        const attrs = node?.attrs || {};
        const me = socket.authState?.creds?.me || socket.user || {};
        const ownJids = [me.id, me.lid].map(standardizeJid).filter(Boolean);
        if (!ownJids.includes(standardizeJid(attrs.from))) return;
        if (attrs.recipient && !ownJids.includes(standardizeJid(attrs.recipient))) return;

        if (attrs.type === "retry") {
            const retry = getBinaryNodeChild(node, "retry");
            const count = Number(retry?.attrs?.count);
            const attempt = Number.isInteger(count) && count > 0 && count <= 5 ? count : "unknown";
            let bundle = "absent";
            if (getBinaryNodeChild(node, "keys")) {
                try {
                    bundle = extractE2ESessionFromRetryReceipt(node) ? "valid" : "invalid";
                } catch {
                    bundle = "invalid";
                }
            }
            // Never log receipt bodies, keys, message IDs or personal JIDs.
            log(`[WhatsApp] Self-chat retry: attempt=${attempt}; keyBundle=${bundle}.`);
        } else if (!attrs.type || attrs.type === "read") {
            const status = attrs.type === "read" ? "read" : "delivered";
            log(`[WhatsApp] Self-chat device receipt: ${status}.`);
        }
    };
    const onConnection = (update) => {
        if (update?.connection === "close") dispose();
    };
    const dispose = () => {
        socket.ws.off?.("CB:receipt", onReceipt);
        socket.ev?.off?.("connection.update", onConnection);
    };
    socket.ws.on("CB:receipt", onReceipt);
    socket.ev?.on?.("connection.update", onConnection);
    return dispose;
}

module.exports = { trackSelfChatDelivery };
