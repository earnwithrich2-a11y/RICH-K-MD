const { areJidsSameUser } = require("gifted-baileys");
const { standardizeJid } = require("./serializer");
const { getLidMapping } = require("./groupCache");

const isPrivateChat = (jid) =>
    jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");

function verifiedPrivateAliases(messageKey) {
    const chat = standardizeJid(messageKey?.remoteJid);
    const aliases = new Set([chat].filter(Boolean));
    if (!isPrivateChat(chat)) return aliases;
    const alternate = standardizeJid(messageKey?.remoteJidAlt);
    // Only transport-supplied alternate addresses or known mappings are used.
    // Sender PN identifies the author, not the outgoing message's recipient.
    if (isPrivateChat(alternate)) aliases.add(alternate);
    for (const jid of [...aliases]) {
        if (jid.endsWith("@lid")) {
            const phone = standardizeJid(getLidMapping(jid));
            if (phone.endsWith("@s.whatsapp.net")) aliases.add(phone);
        }
    }
    return aliases;
}

const isOwnChat = (jid, ownJids) =>
    Boolean(
        jid &&
            ownJids.some(
                (ownJid) => ownJid && areJidsSameUser(jid, ownJid),
            ),
    );

async function findMessageForRetry(store, key, ownJids) {
    if (!store || !key?.id) {
        return { message: undefined, source: "missing", isSelfChat: false };
    }

    const isSelfChat = Boolean(
        key.fromMe && isOwnChat(key.remoteJid, ownJids),
    );
    const exact = key.remoteJid
        ? await store.loadMessage(key.remoteJid, key.id)
        : null;
    if (exact?.message) {
        // Outgoing retry receipts must never rebroadcast received messages,
        // even when their ID exists in this chat's shared message cache.
        if (key.fromMe && exact.key?.fromMe !== true) {
            return { message: undefined, source: "not-outgoing", isSelfChat };
        }
        return { message: exact.message, source: "exact", isSelfChat };
    }

    if (isSelfChat) {
        const alternate = await store.loadMessageById(key.id);
        if (
            alternate?.key?.fromMe &&
            alternate.message &&
            isOwnChat(alternate.key.remoteJid, ownJids)
        ) {
            return {
                message: alternate.message,
                source: "alternate-self",
                isSelfChat,
            };
        }
    } else if (key.fromMe && isPrivateChat(standardizeJid(key.remoteJid))) {
        const alternate = await store.loadMessageById(key.id);
        if (alternate?.key?.fromMe && alternate.message) {
            const requested = verifiedPrivateAliases(key);
            const saved = verifiedPrivateAliases(alternate.key);
            const differentChat = standardizeJid(alternate.key.remoteJid) !== standardizeJid(key.remoteJid);
            const matches = [...saved].some(jid => requested.has(jid));
            const includesOwnChat = [...saved, ...requested].some(jid => isOwnChat(jid, ownJids));
            if (differentChat && matches && !includesOwnChat) {
                return { message: alternate.message, source: "alternate-private", isSelfChat: false };
            }
        }
    }

    return { message: undefined, source: "missing", isSelfChat };
}

async function findMessageForRetryWithWait(store, key, ownJids, delays = [50, 150]) {
    let result = await findMessageForRetry(store, key, ownJids);
    for (const delay of delays) {
        if (result.message || result.source === "not-outgoing" || !key?.fromMe) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        result = await findMessageForRetry(store, key, ownJids);
    }
    return result;
}

module.exports = { findMessageForRetry, findMessageForRetryWithWait };