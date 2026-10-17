function persistOwnOutgoingMessages(socket, store, userDevicesCache) {
    const sendMessage = socket.sendMessage.bind(socket);
    socket.sendMessage = async (...args) => {
        // Preserve the caller's chat. Native upstream routing owns PN/LID
        // migration, sender-device exclusion and companion fan-out.
        const sent = await sendMessage(...args);
        if (
            sent?.key?.fromMe &&
            sent.key.id &&
            sent.message &&
            sent.key.remoteJid
        ) {
            store.saveMessage(sent.key.remoteJid, sent);
        }
        return sent;
    };
}

module.exports = { persistOwnOutgoingMessages };