const { downloadContentFromMessage } = require("gifted-baileys");

async function mediaContent(mediaType, media, download = downloadContentFromMessage) {
    const type = mediaType.replace(/Message$/, "");
    if (!["image", "video", "audio", "sticker"].includes(type)) throw new Error("Unsupported media");
    const stream = await download({ ...media, viewOnce: false }, type, { options: { timeout: 20000 } });
    const timer = setTimeout(() => stream.destroy(new Error("Media download timed out")), 20000);
    timer.unref?.();
    try {
        const chunks = [];
        let size = 0;
        for await (const chunk of stream) {
            size += chunk.length;
            if (size > 32 * 1024 * 1024) throw new Error("Media exceeds the 32 MB safety limit");
            chunks.push(chunk);
        }
        if (!size) throw new Error("Media download was empty");
        return {
            [type]: Buffer.concat(chunks),
            ...(media.mimetype ? { mimetype: media.mimetype } : {}),
            ...(["image", "video"].includes(type) && media.caption ? { caption: media.caption } : {}),
            ...(type === "audio" ? { ptt: !!media.ptt } : {}),
        };
    } finally {
        clearTimeout(timer);
        stream.destroy();
    }
}

module.exports = { mediaContent };
