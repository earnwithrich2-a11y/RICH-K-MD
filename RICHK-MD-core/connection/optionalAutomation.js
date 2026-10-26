const { extractViewOnceMedia } = require("./viewOnceMedia");
const { mediaContent } = require("./automationMedia");
const { connectedUserJid } = require("./messageRecovery");
const { messageText, isMessageEdit } = require("../groupLinkLock");

function isChat(jid) {
    return /@(s\.whatsapp\.net|lid|g\.us)$/.test(jid || "");
}

function modeMatches(mode, group, command) {
    return ["all", "true", "on"].includes(mode) || (mode === "dm" && !group) ||
        (mode === "groups" && group) || (mode === "commands" && command);
}

// Bound replay memory and action frequency even during reconnect/resend storms.
function gate(now = Date.now) {
    const recent = new Map();
    return (key, duration) => {
        const time = now();
        if ((recent.get(key) || 0) > time) return false;
        recent.delete(key);
        recent.set(key, time + duration);
        if (recent.size > 4096) recent.delete(recent.keys().next().value);
        return true;
    };
}

function installOptionalAutomation(socket, {
    getSettings, resolveJid = async jid => jid, saveMedia = mediaContent,
    now = Date.now, intervalMs = 45000,
    report = () => console.warn("[Automation] An optional action failed; other handlers remain active."),
}) {
    const allow = gate(now);
    const resets = new Map();
    const counts = new Map();
    const mediaQueue = [];
    let downloads = 0;
    let online = false;
    let lastAlways = false;
    let alwaysBusy = false;
    let stopped = false;

    function budget(action, limit) {
        let bucket = counts.get(action);
        if (!bucket || bucket.until <= now()) {
            bucket = { count: 0, until: now() + 60000 };
            counts.set(action, bucket);
        }
        return ++bucket.count <= limit;
    }

    function startDownloads() {
        while (!stopped && downloads < 3 && mediaQueue.length) {
            const job = mediaQueue.shift();
            downloads++;
            void Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => {
                downloads--;
                startDownloads();
            });
        }
    }

    function queueMedia(work) {
        if (stopped || mediaQueue.length >= 32) return Promise.reject(new Error("Automatic media queue is full"));
        return new Promise((resolve, reject) => {
            mediaQueue.push({ work, resolve, reject });
            startDownloads();
        });
    }

    async function syncOnline() {
        if (!online || stopped || alwaysBusy) return;
        alwaysBusy = true;
        try {
            const settings = await getSettings();
            const enabled = settings.ALWAYS_ONLINE === "true";
            if (enabled || lastAlways) await socket.sendPresenceUpdate(enabled ? "available" : "unavailable");
            lastAlways = enabled;
        } catch { report(); }
        finally { alwaysBusy = false; }
    }

    async function presence(jid, settings) {
        const mode = settings[jid.endsWith("@g.us") ? "GC_PRESENCE" : "DM_PRESENCE"];
        const state = { typing: "composing", recording: "recording", online: "available" }[mode];
        if (!state || !allow(`presence:${jid}`, 10000) || !budget("presence", 60)) return;
        await socket.sendPresenceUpdate(state, jid);
        if (state === "available") return;
        clearTimeout(resets.get(jid));
        if (resets.size >= 256) {
            const oldest = resets.keys().next().value;
            clearTimeout(resets.get(oldest));
            resets.delete(oldest);
            void Promise.resolve(socket.sendPresenceUpdate("paused", oldest)).catch(report);
        }
        const timer = setTimeout(() => {
            resets.delete(jid);
            void Promise.resolve(socket.sendPresenceUpdate("paused", jid)).catch(report);
        }, 5000);
        timer.unref?.();
        resets.set(jid, timer);
    }

    async function status(msg, settings) {
        if (settings.AUTO_READ_STATUS !== "true" || !budget("status", 60)) return;
        const participant = await resolveJid(msg.participant || msg.key.participantPn || msg.key.participant);
        if (!participant) return;
        const key = { ...msg.key, participant };
        await socket.readMessages([key]);
        if (settings.AUTO_LIKE_STATUS === "true" && allow(`status-like:${participant}`, 10000) && budget("like", 20)) {
            const choices = String(settings.STATUS_LIKE_EMOJIS || "❤️").split(",").map(x => x.trim()).filter(Boolean);
            await socket.sendMessage("status@broadcast", {
                react: { text: choices[Math.floor(Math.random() * choices.length)] || "❤️", key },
            }, { statusJidList: [participant] });
        }
        if (settings.AUTO_REPLY_STATUS === "true" && allow(`status-reply:${participant}`, 60000) && budget("reply", 10)) {
            await socket.sendMessage(participant, { text: settings.STATUS_REPLY_TEXT || "Status viewed." });
        }
    }

    async function process(msg, settings) {
        const jid = msg?.key?.remoteJid;
        if (!msg?.message || !msg.key?.id || msg.key.fromMe || isMessageEdit(msg.message)) return;
        if (!isChat(jid) && jid !== "status@broadcast") return;
        if (!allow(`message:${jid}:${msg.key.id}`, 5 * 60 * 1000)) return;
        if (jid === "status@broadcast") return status(msg, settings);
        if (msg.message.protocolMessage || msg.message.reactionMessage || msg.message.senderKeyDistributionMessage) return;
        // Independent failures never disable another optional feature.
        const tasks = [presence(jid, settings)];
        const command = messageText(msg.message).trimStart().startsWith(settings.PREFIX || ".");
        if (modeMatches(settings.AUTO_READ_MESSAGES, jid.endsWith("@g.us"), command) && budget("read", 120)) {
            tasks.push(socket.readMessages([msg.key]));
        }
        if (modeMatches(settings.AUTO_REACT, jid.endsWith("@g.us"), command) &&
            allow(`react:${jid}`, 3000) && budget("react", 30)) {
            tasks.push(socket.sendMessage(jid, { react: { key: msg.key, text: "❤️" } }));
        }
        const viewOnce = extractViewOnceMedia(msg.message);
        if (viewOnce && settings.ANTIVIEWONCE === "indm") {
            const target = connectedUserJid(socket);
            if (target) tasks.push(queueMedia(async () => {
                if ((await getSettings()).ANTIVIEWONCE !== "indm") return;
                const content = await saveMedia(viewOnce.mediaType, viewOnce.media);
                // Toggling OFF while a download runs must prevent delivery.
                if (!stopped && (await getSettings()).ANTIVIEWONCE === "indm") await socket.sendMessage(target, content);
            }));
        }
        await Promise.all(tasks.map(task => Promise.resolve(task).catch(report)));
    }

    async function upsert(event) {
        try {
            const settings = await getSettings();
            // Ignore history. Some fresh live messages legitimately use append.
            await Promise.all((event.messages || []).map(async msg => {
                try {
                    const raw = msg?.messageTimestamp;
                    const seconds = typeof raw?.toNumber === "function" ? raw.toNumber() : Number(raw?.low ?? raw);
                    if (event.type !== "notify" && !(event.type === "append" &&
                        seconds * 1000 >= now() - 60000 && seconds * 1000 <= now() + 30000)) return;
                    await process(msg, settings);
                } catch { report(); }
            }));
        } catch { report(); }
    }
    function connection({ connection }) {
        online = connection === "open" || (online && connection !== "close");
        if (connection === "open") void syncOnline();
        if (connection === "close") destroy();
    }
    function destroy() {
        stopped = true;
        online = false;
        clearInterval(timer);
        for (const job of mediaQueue.splice(0)) job.reject(new Error("Socket closed"));
        for (const timeout of resets.values()) clearTimeout(timeout);
        resets.clear();
        socket.ev.off("messages.upsert", upsert);
        socket.ev.off("connection.update", connection);
    }
    const timer = setInterval(() => void syncOnline(), intervalMs);
    timer.unref?.();
    socket.ev.on("messages.upsert", upsert);
    socket.ev.on("connection.update", connection);
    socket.optionalAutomation = { syncOnline, destroy };
    return socket.optionalAutomation;
}

module.exports = { installOptionalAutomation, modeMatches };
