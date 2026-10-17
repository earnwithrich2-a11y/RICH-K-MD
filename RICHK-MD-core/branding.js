const FOOTER = "⚡ Powered by https://boosting.richkaurex.site 📢 WhatsApp Channel: https://whatsapp.com/channel/0029VbE9wUJ0Vyc8uRaMNM21";

function appendFooter(text = "") {
    return text.includes(FOOTER) ? text : `${text}\n\n${FOOTER}`;
}

// Return a copy: don't modify quoted originals or cached retry payloads.
function brandProto(message) {
    if (!message) return { message, branded: false };
    const copy = { ...message };
    if (typeof copy.conversation === "string") {
        copy.conversation = appendFooter(copy.conversation);
        return { message: copy, branded: true };
    }
    for (const type of ["extendedTextMessage", "imageMessage", "videoMessage", "documentMessage"]) {
        if (copy[type]) {
            const field = type === "extendedTextMessage" ? "text" : "caption";
            copy[type] = { ...copy[type], [field]: appendFooter(copy[type][field]) };
            return { message: copy, branded: true };
        }
    }
    for (const type of ["interactiveMessage", "listMessage", "buttonsMessage", "templateMessage"]) {
        if (!copy[type]) continue;
        const node = { ...copy[type] };
        if (type === "interactiveMessage") node.footer = { text: FOOTER };
        else if (type === "templateMessage" && node.hydratedTemplate) {
            node.hydratedTemplate = { ...node.hydratedTemplate, hydratedFooterText: FOOTER };
        } else if (type === "templateMessage") continue;
        else node.footerText = FOOTER;
        copy[type] = node;
        return { message: copy, branded: true };
    }
    for (const type of ["viewOnceMessage", "viewOnceMessageV2", "ephemeralMessage", "documentWithCaptionMessage"]) {
        if (copy[type]?.message) {
            const result = brandProto(copy[type].message);
            copy[type] = { ...copy[type], message: result.message };
            return { message: copy, branded: result.branded };
        }
    }
    return { message, branded: false };
}

function installBranding(socket) {
    const send = socket.sendMessage.bind(socket);
    socket.sendMessage = async (jid, content, options) => {
        if (!content || content.react || content.delete || content.protocolMessage) {
            return send(jid, content, options);
        }
        let branded = false;
        let next = { ...content };
        if (typeof next.text === "string") {
            next.text = appendFooter(next.text);
            branded = true;
        } else if (next.image || next.video || next.document) {
            next.caption = appendFooter(next.caption);
            branded = true;
        } else if (next.forward) {
            const result = brandProto(next.forward.message);
            next.forward = { ...next.forward, message: result.message };
            branded = result.branded;
        }
        const sent = await send(jid, next, options);
        // WhatsApp audio/sticker/contact/location messages cannot carry captions.
        if (!branded && (next.audio || next.sticker || next.contacts || next.location || next.poll || next.forward)) {
            await send(jid, { text: FOOTER }, { quoted: sent });
        }
        return sent;
    };
    const relay = socket.relayMessage.bind(socket);
    socket.relayMessage = async (jid, message, options) => {
        // Native sendMessage uses its closed-over relay; this covers plugins
        // directly relaying interactive menus. Never change protocol/control packets.
        const result = brandProto(message);
        const sent = await relay(jid, result.message, options);
        if (!result.branded && (message?.audioMessage || message?.stickerMessage || message?.contactMessage)) {
            await send(jid, { text: FOOTER });
        }
        return sent;
    };
}

module.exports = { FOOTER, appendFooter, brandProto, installBranding };
