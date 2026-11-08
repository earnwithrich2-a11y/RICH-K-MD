function extractViewOnceMedia(quoted) {
    let content = quoted;
    let viewOnceWrapper = false;
    const mediaTypes = ["imageMessage", "videoMessage", "audioMessage"];

    for (let depth = 0; content && depth < 6; depth++) {
        for (const mediaType of mediaTypes) {
            const media = content[mediaType];
            if (media && (viewOnceWrapper || media.viewOnce)) {
                return { mediaType, media };
            }
        }

        if (content.ephemeralMessage?.message) {
            content = content.ephemeralMessage.message;
        } else {
            const wrapper =
                content.viewOnceMessage ||
                content.viewOnceMessageV2 ||
                content.viewOnceMessageV2Extension;
            if (!wrapper?.message) return null;
            viewOnceWrapper = true;
            content = wrapper.message;
        }
    }
    return null;
}

function hasViewOnceMarker(content) {
    for (let depth = 0; content && depth < 6; depth++) {
        if (content.viewOnceMessage || content.viewOnceMessageV2 || content.viewOnceMessageV2Extension ||
            ["imageMessage", "videoMessage", "audioMessage"].some(type => content[type]?.viewOnce)) return true;
        content = content.ephemeralMessage?.message || content.deviceSentMessage?.message;
    }
    return false;
}

module.exports = { extractViewOnceMedia, hasViewOnceMarker };