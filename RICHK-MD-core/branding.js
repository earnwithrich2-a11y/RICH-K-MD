const { AsyncLocalStorage } = require("node:async_hooks");

// Kept for settings compatibility. It is never automatically appended.
const FOOTER = "⚡ Powered by https://boosting.richkaurex.site 📢 WhatsApp Channel: https://whatsapp.com/channel/0029VbE9wUJ0Vyc8uRaMNM21";
const outputContext = new AsyncLocalStorage();
const explicitLinkResults = new Set(["boost", "services", "sms", "otp", "deposit", "balance", "chjid", "channeljid", "newsletterjid", "newsletterinfo", "newsletter", "channelinfo"]);

function runCommandOutput(command, settings, work) {
    return outputContext.run({
        clean: !["menu", "settings"].includes(command),
        keepResultLinks: explicitLinkResults.has(command),
        footer: settings.FOOTER, caption: settings.CAPTION,
    }, work);
}

function cleanText(text, policy = {}) {
    if (typeof text !== "string") return text;
    const bare = line => line.replace(/^[\s>*_~`]+|[\s>*_~`]+$/g, "");
    return text.split("\n").filter(line => {
        const normalized = bare(line);
        if ([policy.footer, policy.caption].some(value => value && normalized === bare(value))) return false;
        if (/^\s*(?:>|©)/.test(line) && /^RICH[-\s]*K[-\s]*MD$/i.test(normalized.replace(/^©\s*/, ""))) return false;
        if (/powered\s*by|ᴘᴏᴡᴇʀᴇᴅ\s*ʙʏ/i.test(line)) return false;
        if (!policy.keepResultLinks && /(?:https?:\/\/)?(?:www\.)?(?:whatsapp\.com\/channel\/|(?:boosting\.)?richkaurex\.site(?:\/|\b)|(?:rivo\.)?skills\.everydayshop\.space)/i.test(line)) return false;
        // Don't leave empty Markdown decoration where a footer used to be.
        return !/^[\s>*_~`]+$/.test(line);
    }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanContent(content, policy, depth = 0) {
    if (!content || typeof content !== "object" || depth > 16 ||
        Buffer.isBuffer(content) || content instanceof Uint8Array || typeof content.pipe === "function") return content;
    if (Array.isArray(content)) return content.map(item => cleanContent(item, policy, depth + 1));
    // Control packets, quoted originals and binary media are not command output text.
    if (content.react || content.delete || content.protocolMessage || content.reactionMessage) return content;
    const result = { ...content };
    delete result.externalAdReply;
    delete result.forwardedNewsletterMessageInfo;
    for (const key of Object.keys(result)) {
        if (["quotedMessage", "messageContextInfo", "key", "mediaKey", "fileSha256", "fileEncSha256"].includes(key)) continue;
        if (["footer", "footerText", "hydratedFooterText"].includes(key)) {
            delete result[key];
        } else if (["text", "conversation", "caption", "contentText", "title", "description", "hydratedContentText"].includes(key)) {
            result[key] = cleanText(result[key], policy);
            if (key === "caption" && !result[key]) delete result[key];
        } else if (key === "buttonParamsJson" && typeof result[key] === "string") {
            try {
                const params = JSON.parse(result[key]);
                if (!policy.keepResultLinks && /richkaurex\.site|whatsapp\.com\/channel\//i.test(params.url || "")) {
                    return null; // Remove promotional link buttons, not functional download buttons.
                }
            } catch { /* Leave non-JSON provider payloads intact. */ }
        } else if (result[key] && typeof result[key] === "object") {
            // Preserve Long/protobuf scalar objects and non-text media metadata.
            if (typeof result[key].toNumber === "function") continue;
            result[key] = cleanContent(result[key], policy, depth + 1);
            if (Array.isArray(result[key])) result[key] = result[key].filter(Boolean);
        }
    }
    return result;
}

function installBranding(socket) {
    const send = socket.sendMessage.bind(socket);
    socket.sendMessage = (jid, content, options) => {
        const policy = outputContext.getStore();
        return send(jid, policy?.clean ? cleanContent(content, policy) : content, options);
    };
    const relay = socket.relayMessage.bind(socket);
    socket.relayMessage = (jid, message, options) => {
        const policy = outputContext.getStore();
        return relay(jid, policy?.clean ? cleanContent(message, policy) : message, options);
    };
}

module.exports = { FOOTER, installBranding, runCommandOutput, cleanText, cleanContent };
