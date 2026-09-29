const { standardizeJid } = require("./serializer");

function persistOwnOutgoingMessages(socket, store) {
    const sendMessage = socket.sendMessage.bind(socket);
    socket.sendMessage = async (...args) => {
        const sent = await sendMessage(...args);
        const ownJids = [socket.user?.id, socket.user?.lid].map(standardizeJid);
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