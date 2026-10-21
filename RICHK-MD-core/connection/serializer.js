const { getContentType, normalizeMessageContent, downloadContentFromMessage, downloadMediaMessage } = require('gifted-baileys');
const { getLidMapping } = require('./groupCache');

const standardizeJid = (jid) => {
    if (!jid) return '';
    try {
        jid = typeof jid === 'string' ? jid : 
            (jid.decodeJid ? jid.decodeJid() : String(jid));
        jid = jid.split('/')[0];
        const at = jid.indexOf('@');
        const user = (at === -1 ? jid : jid.slice(0, at)).split(':')[0];
        const server = at === -1 ? 's.whatsapp.net' : jid.slice(at + 1);
        return `${user}@${server}`.toLowerCase();
    } catch (e) {
        console.error('JID standardization error:', e);
        return '';
    }
};

const convertLidToJid = (lid) => {
    if (!lid) return '';
    if (!lid.endsWith('@lid')) return lid;
    const cached = getLidMapping(lid);
    if (cached) return cached;
    return lid;
};

function extractMessageText(ms) {
    const content = normalizeMessageContent(ms?.message?.deviceSentMessage?.message || ms?.message);
    if (!content) return '';
    const interactive = content.interactiveResponseMessage;
    let buttonId;
    try {
        buttonId = JSON.parse(interactive?.nativeFlowResponseMessage?.paramsJson || '{}').id;
    } catch { /* A malformed button still may contain ordinary text. */ }
    const text = buttonId || interactive?.buttonId || interactive?.body?.text ||
        content.buttonsResponseMessage?.selectedButtonId ||
        content.listResponseMessage?.singleSelectReply?.selectedRowId ||
        content.templateButtonReplyMessage?.selectedId ||
        content.conversation || content.extendedTextMessage?.text ||
        content.imageMessage?.caption || content.videoMessage?.caption || '';
    return typeof text === 'string' ? text : '';
}

const serializeMessage = async (ms, Gifted, settings = {}) => {
    if (!ms?.message || !ms?.key) return null;

    const botId = standardizeJid(Gifted.user?.id || Gifted.authState?.creds?.me?.id);
    // Linked-device copies and disappearing/view-once envelopes contain the
    // actual text inside another message. Keep the original for quoting/media.
    const content = normalizeMessageContent(ms.message.deviceSentMessage?.message || ms.message);
    if (!content) return null;
    const type = getContentType(content);
    const ownLid = standardizeJid(Gifted.authState?.creds?.me?.lid || Gifted.user?.lid);
    const remoteJid = standardizeJid(ms.key.remoteJid);
    const remoteJidAlt = standardizeJid(ms.key.remoteJidAlt);
    const ownJids = [botId, ownLid].filter(Boolean);
    const isOwnStatus = remoteJid === 'status@broadcast' &&
        (ms.key.fromMe === true ||
            [ms.key.participant, ms.key.participantAlt, ms.key.participantPn]
                .some(jid => ownJids.includes(standardizeJid(jid))));
    // Status/notes commands are private controls, not broadcast replies.
    if (remoteJid === 'status@broadcast' && !isOwnStatus) return null;
    const isMessageYourself =
        isOwnStatus || ((botId && remoteJid === botId) ||
            (remoteJid.endsWith('@lid') &&
                ((ownLid && remoteJid === ownLid) ||
                    (botId && remoteJidAlt === botId) ||
                    (ownLid && remoteJidAlt === ownLid))));
    const from = isMessageYourself ? botId : remoteJid;
    const isGroup = from.endsWith('@g.us');
    
    let sendr = (ms.key.fromMe || isMessageYourself)
        ? botId
        : (ms.key.senderPn || ms.key.participantPn || ms.key.participantAlt ||
            (isGroup ? ms.key.participant : ms.key.remoteJidAlt || ms.key.remoteJid));
    sendr = standardizeJid(sendr);
    if (sendr.endsWith('@lid')) {
        try {
            sendr = standardizeJid(
                await Gifted.signalRepository?.lidMapping?.getPNForLID(sendr) ||
                convertLidToJid(sendr),
            );
        } catch {
            // Missing mappings must not grant phone-number owner privileges.
            sendr = convertLidToJid(sendr);
        }
    }
    
    let body = '';
    let isButtonResponse = false;
    let buttonId = null;
    
    if (content.interactiveResponseMessage) {
        isButtonResponse = true;
        try {
            const paramsJson = content.interactiveResponseMessage.nativeFlowResponseMessage?.paramsJson;
            if (paramsJson) {
                buttonId = JSON.parse(paramsJson)?.id || null;
            }
        } catch (e) {
            buttonId = null;
        }
        if (!buttonId) {
            buttonId = content.interactiveResponseMessage.buttonId || null;
        }
        body = buttonId || content.interactiveResponseMessage?.body?.text || '';
    } else if (content.buttonsResponseMessage?.selectedButtonId) {
        isButtonResponse = true;
        buttonId = content.buttonsResponseMessage.selectedButtonId;
        body = buttonId;
    } else if (content.listResponseMessage?.singleSelectReply?.selectedRowId) {
        isButtonResponse = true;
        buttonId = content.listResponseMessage.singleSelectReply.selectedRowId;
        body = buttonId;
    } else if (content.templateButtonReplyMessage?.selectedId) {
        isButtonResponse = true;
        buttonId = content.templateButtonReplyMessage.selectedId;
        body = buttonId;
    } else if (type === 'conversation') {
        body = content.conversation;
    } else if (type === 'extendedTextMessage') {
        body = content.extendedTextMessage.text;
    } else if (type === 'imageMessage' && content.imageMessage.caption) {
        body = content.imageMessage.caption;
    } else if (type === 'videoMessage' && content.videoMessage.caption) {
        body = content.videoMessage.caption;
    }
    body = typeof body === 'string' ? body : '';

    const botPrefix = settings.PREFIX || '.';
    const isCommand = body.startsWith(botPrefix);
    const command = isCommand ? body.slice(botPrefix.length).trim().split(' ').shift().toLowerCase() : '';
    const args = typeof body === 'string' ? body.trim().split(/\s+/).slice(1) : [];

    const repliedMessage = content.extendedTextMessage?.contextInfo?.quotedMessage || null;
    const quoted = type == 'extendedTextMessage' && 
        content.extendedTextMessage.contextInfo != null
        ? content.extendedTextMessage.contextInfo.quotedMessage || []
        : [];
    
    const mentionedJid = (content.extendedTextMessage?.contextInfo?.mentionedJid || []).map(standardizeJid);
    const tagged = type === 'extendedTextMessage' && content.extendedTextMessage.contextInfo != null
        ? content.extendedTextMessage.contextInfo.mentionedJid
        : [];
    
    const contextInfo = content.extendedTextMessage?.contextInfo ||
        content.imageMessage?.contextInfo ||
        content.videoMessage?.contextInfo ||
        content.audioMessage?.contextInfo ||
        content.documentMessage?.contextInfo ||
        content.stickerMessage?.contextInfo || null;
    
    const quotedMsg = contextInfo?.quotedMessage || null;
    const rawQuotedUser = contextInfo?.participant || contextInfo?.remoteJid;
    const quotedUser = convertLidToJid(standardizeJid(rawQuotedUser));
    const repliedMessageAuthor = convertLidToJid(standardizeJid(contextInfo?.participant));
    
    const quotedStanzaId = contextInfo?.stanzaId || null;
    const quotedKey = quotedStanzaId ? {
        remoteJid: contextInfo?.remoteJid || ms.key.remoteJid || from,
        fromMe: Boolean(
            rawQuotedUser &&
            [botId, ownLid].includes(standardizeJid(rawQuotedUser))
        ),
        id: quotedStanzaId,
        participant: isGroup ? rawQuotedUser : undefined
    } : null;
    
    let messageAuthor = isGroup 
        ? standardizeJid(ms.key.participant || ms.participant || from)
        : from;
    if (ms.key.fromMe) messageAuthor = botId;
    
    const user = mentionedJid.length > 0 
        ? mentionedJid[0] 
        : repliedMessage 
            ? repliedMessageAuthor 
            : '';

    return {
        ms,
        mek: ms,
        type,
        from,
        isGroup,
        sender: sendr,
        botId,
        body,
        isCommand,
        command,
        args,
        q: args.join(' '),
        pushName:
            ms.pushName ||
            ms.verifiedBizName ||
            ms.notifyName ||
            ms.key?.pushName ||
            sendr?.split("@")[0] ||
            "WhatsApp User",
        quoted,
        repliedMessage,
        mentionedJid,
        tagged,
        quotedMsg,
        quotedKey,
        quotedUser,
        repliedMessageAuthor,
        messageAuthor,
        user,
        prefix: botPrefix,
        isButtonResponse,
        buttonId
    };
};

module.exports = {
    extractMessageText,
    standardizeJid,
    convertLidToJid,
    serializeMessage,
    downloadMediaMessage
};
