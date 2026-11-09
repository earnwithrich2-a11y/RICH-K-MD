// Resolve account identity from this socket, never from another deployment's settings.
function normalizeIdentity(value) {
    if (typeof value !== "string") return "";
    const match = value.match(/^(\d+)(?::\d+)?@(s\.whatsapp\.net|c\.us|lid)$/);
    return match ? `${match[1]}@${match[2] === "c.us" ? "s.whatsapp.net" : match[2]}` : "";
}

function connectedOwnerJid(socket) {
    return [socket?.user?.id, socket?.authState?.creds?.me?.id]
        .map(normalizeIdentity).find(jid => jid.endsWith("@s.whatsapp.net")) || "";
}

function isConnectedOwner(socket, sender) {
    const jid = normalizeIdentity(sender);
    return Boolean(jid && [
        socket?.user?.id, socket?.user?.lid,
        socket?.authState?.creds?.me?.id, socket?.authState?.creds?.me?.lid,
    ].map(normalizeIdentity).includes(jid));
}

module.exports = { connectedOwnerJid, isConnectedOwner, normalizeIdentity };
