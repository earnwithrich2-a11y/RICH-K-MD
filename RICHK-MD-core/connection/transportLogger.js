// Only fixed transport event names may reach logs. Never forward SDK objects:
// they can contain personal addresses, plaintext or cryptographic material.
const EVENTS = new Map([
    ["injected session from retry receipt key bundle", "Retry session restored from recipient key bundle."],
    ["retry key bundle rejected; falling back to server session", "Recipient retry bundle rejected; trying server keys."],
    ["forced new session for retry recp", "Retry session prepared; attempting resend."],
    ["error in sending message again", "Retry resend failed."],
    ["retry message unavailable; preserving sessions", "Retry payload unavailable; encryption sessions preserved."],
    ["will not send message again, as sent too many times", "Retry attempt limit reached."],
    ["blacklisting dead device", "Recipient key lookup failed; device excluded by transport."],
]);

function createTransportLogger(log = console.info) {
    const emit = (...args) => {
        for (const arg of args) {
            if (typeof arg !== "string" || !EVENTS.has(arg)) continue;
            log(`[WhatsApp] ${EVENTS.get(arg)}`);
            break;
        }
    };
    return {
        level: "silent",
        trace() {},
        debug: emit,
        info: emit,
        warn: emit,
        error: emit,
        fatal: emit,
        child() { return this; },
    };
}

module.exports = { createTransportLogger };
