const { Boom } = require("@hapi/boom");
const { DisconnectReason } = require("gifted-baileys");
const fs = require("fs-extra");
const path = require("path");
const { setupGroupCacheListeners } = require("./groupCache");

const RECONNECT_DELAY = 5000;
const MAX_RECONNECT_ATTEMPTS = 50;

let reconnectAttempts = 0;

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
        reconnectAttempts = Math.min(reconnectAttempts + 1, MAX_RECONNECT_ATTEMPTS);
        const delay = Math.min(RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), 300000);
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
            reconnectAttempts = 0;

            if (callbacks.onOpen) {
                try { await callbacks.onOpen(Gifted); }
                catch { console.warn("[WhatsApp] Post-connection action unavailable; connection remains active."); }
            }
        }

        if (connection === "close") {
            isOpen = false;
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`Connection closed due to: ${reason}`);

            if ([408, 428, 503, 515].includes(reason)) {
                handleReconnect();
                return;
            }

            switch (reason) {
                case DisconnectReason.badSession:
                    cancelReconnect();
                    retired = true;
                    console.log(
                        "WhatsApp rejected the session. Login data is preserved; re-pairing requires approval.",
                    );
                    Gifted.authRequired = true;
                    break;

                case DisconnectReason.connectionReplaced:
                    cancelReconnect();
                    retired = true;
                    console.log(
                        "Connection replaced, another new session opened",
                    );
                    Gifted.connectionReplaced = true;
                    break;

                case DisconnectReason.loggedOut:
                    cancelReconnect();
                    retired = true;
                    console.log(
                        "WhatsApp reported a logout. Login data is preserved; re-pairing requires approval.",
                    );
                    Gifted.authRequired = true;
                    break;

                case DisconnectReason.connectionClosed:
                case DisconnectReason.connectionLost:
                case DisconnectReason.restartRequired:
                    console.log("🕗 Reconnecting...");
                    handleReconnect();
                    break;

                case DisconnectReason.timedOut:
                    console.log("Connection timed out, reconnecting...");
                    handleReconnect();
                    break;

                default:
                    console.log(
                        `Unknown disconnect reason: ${reason}, attempting reconnection...`,
                    );
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
    MAX_RECONNECT_ATTEMPTS,
};
