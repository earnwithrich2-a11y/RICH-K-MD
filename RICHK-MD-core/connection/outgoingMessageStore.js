const { standardizeJid } = require("./serializer");
const { selfChatDestination } = require("./selfChatTransport");

function persistOwnOutgoingMessages(socket, store, userDevicesCache) {
    const sendMessage = socket.sendMessage.bind(socket);
    socket.sendMessage = async (...args) => {
        const me = {
            id: socket.authState?.creds?.me?.id || socket.user?.id,
            lid: socket.authState?.creds?.me?.lid || socket.user?.lid,
        };
        const ownJids = [me.id, me.lid].map(standardizeJid).filter(Boolean);
        if (ownJids.includes(standardizeJid(args[0]))) {
            args[0] = selfChatDestination(args[0], me);
            // This transport does not forward useUserDevicesCache from
            // sendMessage to relayMessage. Invalidate only our own entries
            // so its normal discovery path actually fetches fresh devices.
            userDevicesCache?.del(ownJids.map((jid) => jid.split("@")[0]));
        }
        const sent = await sendMessage(...args);
        if (
            sent?.key?.fromMe &&
            sent.key.id &&
            sent.message &&
            ownJids.includes(standardizeJid(sent.key.remoteJid))
        ) {
            store.saveMessage(sent.key.remoteJid, sent);
        }
        return sent;
    };
}

module.exports = { persistOwnOutgoingMessages };