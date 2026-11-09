const { Boom } = require("@hapi/boom");
const { DisconnectReason } = require("gifted-baileys");
const { setupGroupCacheListeners } = require("./groupCache");

const RECONNECT_DELAY = 15000;

const safeNewsletterFollow = async (Gifted, newsletterJid) => {
    if (!newsletterJid) return false;
    try {
        await Gifted.newsletterFollow(newsletterJid);
        // console.log(`✅ Followed Channel: ${newsletterJid}`);
        return true;
    } catch (error) {
        console.error(
            `❌ Channel follow failed for ${newsletterJid}:`,
            error.message,
        );
        return false;
    }
};

const safeGroupAcceptInvite = async (Gifted, groupJid) => {
    if (!groupJid) return false;
    try {
        await Gifted.groupAcceptInvite(groupJid);
        // console.log(`✅ Joined group: ${groupJid}`);
        return true;
    } catch (error) {
        switch (error.data) {
            case 409:
                console.log(`ℹ️ Already in group: ${groupJid}`);
                break;
            case 400:
                console.log(`⚠️ Invalid invite code for group: ${groupJid}`);
                break;
            case 403:
                console.log(`⚠️ No permission to join group: ${groupJid}`);
                break;
            default:
                console.error(
                    `❌ Group join failed for ${groupJid}:`,
                    error.message,
                );
        }
        return false;
    }
};

const setupConnectionHandler = (
    Gifted,
    sessionDir,
    startGifted,
    callbacks = {},
) => {
    setupGroupCacheListeners(Gifted);
    let isOpen = false;
    let reconnectTimer = null;
    let reconnecting = false;
    let retired = false;
    const schedule = callbacks.schedule || setTimeout;
    const cancel = callbacks.cancel || clearTimeout;
    const cancelReconnect = () => {
        if (reconnectTimer !== null) cancel(reconnectTimer);
        reconnectTimer = null;
    };
    const handleReconnect = () => {
        if (reconnectTimer !== null || reconnecting || retired) return;
        const delay = RECONNECT_DELAY;
        console.info(`[WhatsApp] Reconnecting in ${delay}ms.`);
        reconnectTimer = schedule(async () => {
            reconnectTimer = null;
            reconnecting = true;
            let failed = false;
            try {
                await startGifted();
                retired = true; // This old socket must not launch another instance.
            } catch {
                failed = true;
                console.warn("[WhatsApp] Reconnect failed; retrying without discarding login.");
            } finally {
                reconnecting = false;
                if (failed) handleReconnect();
            }
        }, delay);
    };

    Gifted.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "connecting") {
            console.log("🕗 Connecting Bot...");
        }

        if (connection === "open") {
            if (isOpen) return;
            cancelReconnect();
            isOpen = true;
            console.log("✅ Connection Instance is Online");

            if (callbacks.onOpen) {
                try { await callbacks.onOpen(Gifted); }
                catch { console.warn("[WhatsApp] Post-connection action unavailable; connection remains active."); }
            }
        }

        if (connection === "close") {
            isOpen = false;
            if (Gifted.maintenanceRestarting) {
                console.info("[WhatsApp] Maintenance restart; saved login retained.");
                return;
            }
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`Connection closed due to: ${reason}`);

            if (reason === DisconnectReason.loggedOut) {
                cancelReconnect();
                retired = true;
                console.log("WhatsApp reported a logout. Login data is preserved; re-pairing requires approval.");
                Gifted.authRequired = true;
            } else {
                // Includes badSession/500: retry without clearing any saved credentials.
                handleReconnect();
            }
        }
    });
};

module.exports = {
    safeNewsletterFollow,
    safeGroupAcceptInvite,
    setupConnectionHandler,
    RECONNECT_DELAY,
};
