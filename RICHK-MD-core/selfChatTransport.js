const { jidDecode, jidNormalizedUser } = require("gifted-baileys");

function ownIdentity(jid, me) {
    const target = jidDecode(jid);
    if (!target) return null;
    for (const identity of [me?.id, me?.lid]) {
        const own = jidDecode(identity);
        if (own && target.user === own.user && target.server === own.server) {
            return own;
        }
    }
    return null;
}

function selfChatDestination(jid, me) {
    if (!ownIdentity(jid, me) || !me?.lid) return jid;
    return jidNormalizedUser(me.lid);
}

// The transport's device discovery may return PN and LID aliases for the
// same own device. Never encrypt twice for that device, or encrypt a copy
// back to the linked device that is sending the message.
function prepareSelfChatRecipients(message, jids, me) {
    const destination = message?.deviceSentMessage?.destinationJid;
    if (!ownIdentity(destination, me) || !Array.isArray(jids)) return message;

    const destinationServer = jidDecode(destination).server;
    const recipients = new Map();
    for (const jid of jids) {
        const target = jidDecode(jid);
        if (!target) throw new Error("Invalid self-chat encryption recipient");
        const own = ownIdentity(jid, me);
        if (own && own.device && target.device === own.device) continue;

        const key = own
            ? `own:${target.device || 0}`
            : `${target.user}:${target.device || 0}@${target.server}`;
        if (!recipients.has(key) || (own && target.server === destinationServer)) {
            recipients.set(key, jid);
        }
    }

    if (!recipients.size && jids.length) {
        throw new Error("Refusing to encrypt a self-chat message only to the sending device");
    }
    return [...recipients.values()].map((recipientJid) => ({
        ...message,
        recipientJid,
    }));
}

module.exports = { selfChatDestination, prepareSelfChatRecipients };
