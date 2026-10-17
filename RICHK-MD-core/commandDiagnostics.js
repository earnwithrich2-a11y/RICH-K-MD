// Aggregate counts only: never retain packet objects, addresses or message text.
function attachCommandDiagnostics(socket, now = Date.now) {
    const counts = Object.create(null);
    const times = Object.create(null);
    const waiting = new Set();
    let activeSince = null;
    const mark = name => {
        counts[name] = (counts[name] || 0) + 1;
        times[name] = now();
    };
    socket.ws.on("CB:message", node => {
        mark("messagePackets");
        if (node.attrs?.offline) mark("offlinePackets");
        const timestamp = Number(node.attrs?.t) * 1000;
        if (Number.isFinite(timestamp) && Math.abs(now() - timestamp) <= 60000) {
            mark("recentPackets");
        }
        const children = Array.isArray(node.content) ? node.content : [];
        const enc = children.find(child => child.tag === "enc");
        if (enc) {
            const type = ["msg", "pkmsg", "skmsg", "msmsg"].includes(enc.attrs?.type)
                ? enc.attrs.type : "other";
            mark(`cipher_${type}`);
        } else if (children.some(child => child.tag === "unavailable")) {
            mark("unavailablePackets");
        } else {
            mark("otherPackets");
        }
    });
    socket.ev.on("messages.upsert", ({ messages = [] }) => {
        for (const message of messages) {
            mark("messageEvents");
            if (message.key?.fromMe) mark("ownMessageEvents");
            if (message.message) mark("decryptedEvents");
        }
    });
    if (socket.processingMutex?.mutex) {
        const original = socket.processingMutex.mutex.bind(socket.processingMutex);
        socket.processingMutex.mutex = work => {
            const ticket = { at: now() };
            waiting.add(ticket);
            return original(async () => {
                waiting.delete(ticket);
                activeSince = now();
                try { return await work(); }
                finally { activeSince = null; }
            });
        };
    }
    const diagnostics = {
        mark,
        snapshot() {
            const age = at => at == null ? null : Math.max(0, now() - at);
            return {
                counts: { ...counts },
                lastSeenMsAgo: Object.fromEntries(
                    Object.entries(times).map(([key, value]) => [key, age(value)]),
                ),
                processing: {
                    pending: waiting.size,
                    activeForMs: age(activeSince),
                    oldestWaitingMs: age(waiting.values().next().value?.at),
                },
                offline: socket.getOfflineQueueState?.(),
            };
        },
    };
    socket.commandDiagnostics = diagnostics;
    return diagnostics;
}

module.exports = { attachCommandDiagnostics };
