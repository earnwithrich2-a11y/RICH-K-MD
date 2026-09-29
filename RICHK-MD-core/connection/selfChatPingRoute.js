const { standardizeJid } = require("./serializer");

function selfChatPingDestination(from, message, socket) {
    const ownPhone = standardizeJid(socket.user?.id);
    const ownLid = standardizeJid(
        socket.authState?.creds?.me?.lid || socket.user?.lid,
    );
    const originalChat = standardizeJid(message?.key?.remoteJid);

    if (
        message?.key?.fromMe &&
        ownPhone &&
        from === ownPhone &&
        ownLid &&
        originalChat === ownLid
    ) {
        return ownLid;
    }
    return from;
}

module.exports = { selfChatPingDestination };