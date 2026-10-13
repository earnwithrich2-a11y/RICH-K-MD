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
            const trace = args.find(value => value && typeof value === "object" && typeof value.trace === "string")?.trace || "";
            let reason = "";
            if (arg === "error in sending message again") {
                const categories = [
                    [/Device 99 requires a hosted address/, "NON_HOSTED_DEVICE_99"],
                    [/No sessions|No session|No open session|SessionError/, "SESSION_UNAVAILABLE"],
                    [/UntrustedIdentity/, "RECIPIENT_IDENTITY_CHANGED"],
                    [/Bad MAC|BadMac|Invalid signature/, "RECIPIENT_KEY_REJECTED"],
                    [/Connection Closed|Timed Out|Timeout/, "NETWORK_UNAVAILABLE"],
                    [/Cannot destructure property 'user'|reading 'user'|reading 'split'/, "INVALID_RECIPIENT_ADDRESS"],
                    [/TypeError/, "TRANSPORT_TYPE_ERROR"],
                ];
                reason = categories.find(([pattern]) => pattern.test(trace))?.[1] || "OTHER";
            }
            log(`[WhatsApp] ${EVENTS.get(arg)}${reason ? ` Category: ${reason}` : ""}`);
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
