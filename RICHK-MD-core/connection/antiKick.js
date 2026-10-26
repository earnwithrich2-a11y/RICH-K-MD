const { getGroupRole, botIdentities } = require("../groupLinkLock");

function installAntiKick(socket, { getSetting, getMetadata, now = Date.now,
    report = () => console.warn("[Anti-kick] Could not restore a removed member.") }) {
    const attempts = new Map();
    const handler = async event => {
        try {
            if (event.action !== "remove" || !event.id?.endsWith("@g.us") ||
                await getSetting(event.id, "ANTIKICK") !== "true") return;
            if (!event.author && !event.authorPn) return; // Do not undo unattributed moderation.
            const normalize = jid => typeof jid === "string" ? jid.replace(/:\d+@/, "@") : "";
            const own = new Set(botIdentities(socket).map(normalize).filter(Boolean));
            // Never undo removals performed by this bot's existing protections.
            if ([event.author, event.authorPn].some(jid => jid && own.has(normalize(jid)))) return;
            const metadata = await getMetadata(socket, event.id, { forceRefresh: true });
            const bot = getGroupRole(metadata, botIdentities(socket));
            // A removed/demoted bot cannot restore itself. Never retaliate or promote.
            if (!bot.isAdmin && !bot.isOwner) return;
            for (const participant of event.participants || []) {
                const jid = typeof participant === "string" ? participant :
                    participant.phoneNumber || participant.pn || participant.id;
                if (!/@(s\.whatsapp\.net|lid)$/.test(jid || "")) continue;
                const key = `${event.id}:${jid}`;
                if ((attempts.get(key) || 0) > now()) continue;
                attempts.set(key, now() + 60000);
                if (attempts.size > 1024) attempts.delete(attempts.keys().next().value);
                const result = await socket.groupParticipantsUpdate(event.id, [jid], "add");
                if (result?.some(item => Number(item.status) >= 400)) report();
            }
        } catch { report(); }
    };
    socket.ev.on("group-participants.update", handler);
    const cleanup = ({ connection }) => {
        if (connection !== "close") return;
        socket.ev.off("group-participants.update", handler);
        socket.ev.off("connection.update", cleanup);
        attempts.clear();
    };
    socket.ev.on("connection.update", cleanup);
    return handler;
}

module.exports = { installAntiKick };
