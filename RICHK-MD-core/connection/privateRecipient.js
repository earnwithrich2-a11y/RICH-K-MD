const { standardizeJid } = require("./serializer");
const { getLidMapping } = require("./groupCache");

const privateJid = (jid) => {
    const normalized = standardizeJid(jid);
    return normalized.endsWith("@s.whatsapp.net") || normalized.endsWith("@lid")
        ? normalized
        : null;
};

async function resolvePrivateRecipient({ message, from, sender, isGroup, socket }) {
    const key = message?.key || {};
    if (key.fromMe) {
        const identities = [privateJid(socket?.user?.id), privateJid(sender)].filter(Boolean);
        const self = identities.find((jid) => jid.endsWith("@s.whatsapp.net")) || identities[0];
        if (!self) return null;

        if (!isGroup) {
            const chat = privateJid(key.remoteJid);
            if (
                chat === self ||
                (chat?.endsWith("@lid") &&
                    (privateJid(key.remoteJidAlt) === self || getLidMapping(chat) === self))
            ) {
                return chat;
            }
        }
        return self;
    }

    if (!isGroup) {
        return privateJid(key.remoteJid) || privateJid(from);
    }

    const candidates = [key.participantPn, key.senderPn, key.participantAlt, key.participant, sender];
    const recipients = candidates.map(privateJid).filter(Boolean);
    const phoneJid = recipients.find((jid) => jid.endsWith("@s.whatsapp.net"));
    if (phoneJid) return phoneJid;

    const lid = recipients.find((jid) => jid.endsWith("@lid"));
    if (!lid) return null;

    const cached = privateJid(getLidMapping(lid));
    if (cached?.endsWith("@s.whatsapp.net")) return cached;
    try {
        const resolved = privateJid(await socket?.getJidFromLid?.(lid));
        if (resolved?.endsWith("@s.whatsapp.net")) return resolved;
    } catch (_) {
        // The original LID still identifies the private chat.
    }
    return lid;
}

module.exports = { resolvePrivateRecipient };