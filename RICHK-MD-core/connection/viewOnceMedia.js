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

module.exports = { extractViewOnceMedia };