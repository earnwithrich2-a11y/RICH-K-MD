const heavyCategories = new Set(["ai", "downloader", "download", "converter", "search", "tools"]);
const quickCommands = new Set(["ping", "menu", "settings", "alive", "uptime"]);
const presenceJobs = new WeakMap();

function needsGroupMetadata(command) {
    return !command || (!quickCommands.has(command.pattern) &&
        !heavyCategories.has(String(command.category).toLowerCase()));
}

function safePresence(socket, state, chat) {
    try {
        void Promise.resolve(socket.sendPresenceUpdate?.(state, chat)).catch(() => {});
    } catch { /* Presence is cosmetic and must never block a command. */ }
}

async function runWithPresence(socket, chat, command, work) {
    if (!command?.heavy && !heavyCategories.has(String(command?.category).toLowerCase())) return work();
    let chats = presenceJobs.get(socket);
    if (!chats) presenceJobs.set(socket, chats = new Map());
    let job = chats.get(chat);
    if (!job) {
        safePresence(socket, "composing", chat);
        const timer = setInterval(() => safePresence(socket, "composing", chat), 8000);
        timer.unref?.();
        chats.set(chat, job = { count: 0, timer });
    }
    job.count++;
    try { return await work(); }
    finally {
        if (--job.count === 0) {
            clearInterval(job.timer);
            chats.delete(chat);
            safePresence(socket, "paused", chat);
        }
    }
}

function serviceUnavailable() {
    return "╭─ ⚡ RICH-K-MD\n│ Service momentarily unavailable\n╰─────────────────\n\nSorry, this service couldn't complete your request right now. Please try again shortly.\n\n─ RICH-K-MD";
}

// Cosmetic framing only: never alter control packets, forwarded originals,
// copyable URLs/code, binary media or machine-readable command results.
function premiumText(text) {
    if (typeof text !== "string" || !text.trim() ||
        /╭[^\n]*RICH[-\s]*K[-\s]*MD/i.test(text) ||
        /^(?:https?:\/\/\S+|```[\s\S]*|[{\[][\s\S]*)$/.test(text.trim())) return text;
    return `╭─ ⚡ RICH-K-MD\n╰─────────────────\n\n${text}\n\n─ RICH-K-MD`;
}

function premiumContent(content) {
    if (!content || typeof content !== "object" || content.react || content.delete ||
        content.forward || content.protocolMessage || content.edit) return content;
    const result = { ...content };
    if (typeof result.text === "string") result.text = premiumText(result.text);
    if (typeof result.caption === "string") result.caption = premiumText(result.caption);
    return result;
}

module.exports = { needsGroupMetadata, runWithPresence, serviceUnavailable, premiumText, premiumContent };
