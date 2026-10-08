const { jidDecode, jidNormalizedUser } = require("gifted-baileys");

function normalize(jid) {
    if (typeof jid !== "string" || !jid) return "";
    if (/^\d+$/.test(jid)) jid += "@s.whatsapp.net";
    const decoded = jidDecode(jid);
    return decoded && ["s.whatsapp.net", "lid", "c.us"].includes(decoded.server)
        ? jidNormalizedUser(jid) : "";
}

function identities(values) {
    return new Set(values.map(normalize).filter(Boolean));
}

function getGroupRole(metadata, jids) {
    const actor = identities(jids);
    const members = (metadata?.participants || []).filter((member) =>
        [member.id, member.lid, member.pn, member.jid, member.phoneNumber]
            .some((jid) => actor.has(normalize(jid))),
    );
    for (const member of members) {
        for (const jid of [member.id, member.lid, member.pn, member.jid, member.phoneNumber]) {
            const normalized = normalize(jid);
            if (normalized) actor.add(normalized);
        }
    }
    const owners = identities([
        metadata?.owner, metadata?.ownerPn, metadata?.ownerJid, metadata?.ownerLid,
    ]);
    return {
        isAdmin: members.some((member) => ["admin", "superadmin"].includes(member.admin)),
        isOwner: [...owners].some((jid) => actor.has(jid)),
    };
}

function nextEnvelope(content) {
    return content.ephemeralMessage?.message || content.viewOnceMessage?.message ||
        content.viewOnceMessageV2?.message || content.viewOnceMessageV2Extension?.message ||
        content.documentWithCaptionMessage?.message;
}

function isMessageEdit(content) {
    for (let depth = 0; content && depth < 10; depth += 1) {
        if (content.editedMessage || content.protocolMessage?.editedMessage) return true;
        content = nextEnvelope(content);
    }
    return false;
}

function messageText(content) {
    for (let depth = 0; content && depth < 10; depth += 1) {
        const poll = content.pollCreationMessage || content.pollCreationMessageV2 ||
            content.pollCreationMessageV3;
        const template = content.templateMessage?.hydratedTemplate;
        const contacts = content.contactsArrayMessage?.contacts || [content.contactMessage];
        const contactUrls = contacts.flatMap(contact =>
            [...(contact?.vcard || "").matchAll(/^URL(?:;[^:\r\n]*)?:([^\r\n]+)/gmi)]
                .map(match => match[1]));
        const text = [
            content.conversation, content.extendedTextMessage?.text,
            content.extendedTextMessage?.canonicalUrl,
            content.extendedTextMessage?.contextInfo?.externalAdReply?.sourceUrl,
            content.imageMessage?.caption, content.videoMessage?.caption,
            content.documentMessage?.caption, content.locationMessage?.url,
            poll?.name, ...(poll?.options || []).map(option => option.optionName),
            content.buttonsMessage?.contentText, content.buttonsMessage?.footerText,
            content.interactiveMessage?.body?.text, template?.hydratedContentText,
            ...(template?.hydratedButtons || []).map(button => button.urlButton?.url),
            content.listMessage?.title, content.listMessage?.description,
            ...(content.listMessage?.sections || []).flatMap(section =>
                (section.rows || []).flatMap(row => [row.title, row.description])),
            ...contactUrls,
        ].filter(value => typeof value === "string" && value).join("\n");
        if (text) return text;
        content = nextEnvelope(content) || content.editedMessage?.message ||
            content.protocolMessage?.editedMessage;
    }
    return "";
}

function hasWebLink(text) {
    if (typeof text !== "string") return false;
    text = text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
    if (/(?:https?|ftp):\/\/\S+/i.test(text)) return true;
    return /(?:^|[\s([{<"'“‘:])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+(?:[\p{L}]{2,63}|xn--[a-z0-9-]{2,})(?=$|[\s/:?#)\]}>.,!;"'”’])/iu.test(text);
}

function botIdentities(socket) {
    return [
        socket.user?.id, socket.user?.lid,
        socket.authState?.creds?.me?.id, socket.authState?.creds?.me?.lid,
    ];
}

function senderIdentities(socket, message, extra = []) {
    return message?.key?.fromMe ? botIdentities(socket) : [
        message?.key?.participantPn, message?.key?.participant,
        message?.key?.senderPn, message?.participant, ...extra,
    ];
}

async function enforceGroupLinkLock(socket, message, getMetadata) {
    const from = message?.key?.remoteJid;
    if (!from?.endsWith("@g.us") || !hasWebLink(messageText(message.message))) return false;
    // A recently demoted admin must not retain a cached exemption.
    const metadata = await getMetadata(socket, from, { forceRefresh: true });
    if (!metadata?.participants) throw new Error("URL lock could not verify group permissions.");
    const actor = senderIdentities(socket, message);
    if (!identities(actor).size) throw new Error("URL lock could not identify the message sender.");
    const role = getGroupRole(metadata, actor);
    if (role.isAdmin || role.isOwner) return false;
    const bot = getGroupRole(metadata, botIdentities(socket));
    if (!bot.isAdmin && !bot.isOwner) {
        await socket.sendMessage(from, {
            text: "⚠️ URL lock is enabled, but the bot needs group-admin rights to remove links.",
        });
        return false;
    }
    await socket.sendMessage(from, { delete: message.key });
    await socket.sendMessage(from, {
        text: "🔒 Link removed. Only group admins and the group owner can share links here.",
    });
    return true;
}

module.exports = {
    getGroupRole, messageText, hasWebLink, isMessageEdit, botIdentities, senderIdentities,
    enforceGroupLinkLock,
};
