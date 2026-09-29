function createAntiDeleteRecovery({
    Gifted,
    GiftedAntiDelete,
    findAntiDelete,
    removeAntiDelete,
    getSender,
    botOwnerJid,
    duplicateTtlMs = 60000,
}) {
    const handledDeletions = new Set();

    return async function handleDeletedMessage(
        chatJid,
        deletedId,
        eventKey,
        eventPushName = "Unknown",
    ) {
        if (!chatJid || !deletedId || handledDeletions.has(deletedId)) return;

        const deletedMsg = findAntiDelete(chatJid, deletedId);
        if (!deletedMsg?.message) {
            console.warn(
                `Anti-delete could not find stored message ${deletedId} in ${chatJid}`,
            );
            return;
        }

        handledDeletions.add(deletedId);
        const duplicateTimer = setTimeout(
            () => handledDeletions.delete(deletedId),
            duplicateTtlMs,
        );
        duplicateTimer.unref?.();

        const storedChatJid =
            deletedMsg._antiDeleteStoredJid ||
            deletedMsg.key?.remoteJid ||
            chatJid;
        const reportChatJid = deletedMsg.key?.remoteJid || storedChatJid;
        const eventMessage = {
            key: {
                ...eventKey,
                remoteJid: reportChatJid,
            },
            pushName: eventPushName,
        };
        const deleter = getSender(eventMessage) || deletedMsg.originalSender;
        const samePerson =
            String(deleter || "").split("@")[0] ===
            String(deletedMsg.originalSender || "").split("@")[0];
        const deleterPushName =
            eventPushName !== "Unknown"
                ? eventPushName
                : samePerson
                  ? deletedMsg.originalPushName
                  : "Unknown";

        if (deleter === botOwnerJid) return;

        await GiftedAntiDelete(
            Gifted,
            deletedMsg,
            { ...eventKey, remoteJid: reportChatJid },
            deleter,
            deletedMsg.originalSender,
            botOwnerJid,
            deleterPushName,
            deletedMsg.originalPushName,
        );

        removeAntiDelete(storedChatJid, deletedId);
    };
}

module.exports = { createAntiDeleteRecovery };