const { areJidsSameUser } = require("gifted-baileys");

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
    }

    return { message: undefined, source: "missing", isSelfChat };
}

async function findMessageForRetryWithWait(store, key, ownJids, delays = [50, 150]) {
    let result = await findMessageForRetry(store, key, ownJids);
    for (const delay of delays) {
        if (result.message || !result.isSelfChat) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        result = await findMessageForRetry(store, key, ownJids);
    }
    return result;
}

module.exports = { findMessageForRetry, findMessageForRetryWithWait };