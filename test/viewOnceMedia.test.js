const test = require("node:test");
const assert = require("node:assert/strict");
const { extractViewOnceMedia } = require("../RICHK-MD-core/connection/viewOnceMedia");

test("reveals flagged images without changing their original content", () => {
    const image = { viewOnce: true, mimetype: "image/jpeg", caption: "photo" };
    assert.deepEqual(extractViewOnceMedia({ imageMessage: image }), {
        mediaType: "imageMessage",
        media: image,
    });
    assert.equal(image.viewOnce, true);
});

test("reveals image and video in modern view-once wrappers", () => {
    const image = { mimetype: "image/jpeg" };
    const video = { mimetype: "video/mp4" };
    assert.deepEqual(
        extractViewOnceMedia({ viewOnceMessageV2: { message: { imageMessage: image } } }),
        { mediaType: "imageMessage", media: image },
    );
    assert.deepEqual(
        extractViewOnceMedia({
            ephemeralMessage: {
                message: {
                    viewOnceMessageV2Extension: { message: { videoMessage: video } },
                },
            },
        }),
        { mediaType: "videoMessage", media: video },
    );
});

test("rejects ordinary media and empty wrappers", () => {
    assert.equal(extractViewOnceMedia({ imageMessage: { mimetype: "image/jpeg" } }), null);
    assert.equal(extractViewOnceMedia({ viewOnceMessageV2: {} }), null);
});

test("linked-device outgoing view-once images, video and audio are found inside deviceSentMessage wrappers", () => {
    for (const type of ["image", "video", "audio"]) {
        const media = { mediaKey: Buffer.from("key"), directPath: "/media" };
        const content = { deviceSentMessage: { destinationJid: "100@s.whatsapp.net",
            message: { ephemeralMessage: { message: { viewOnceMessageV2Extension: { message: {
                [`${type}Message`]: media,
            } } } } } } };
        assert.deepEqual(extractViewOnceMedia(content), { mediaType: `${type}Message`, media });
    }
});