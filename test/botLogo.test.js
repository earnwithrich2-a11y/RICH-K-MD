const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { BOT_LOGO, logoThumbnail } = require("../RICHK-MD-core/botLogo");

test("the bundled logo supplies a cached JPEG thumbnail for WhatsApp replies", async () => {
    const first = await logoThumbnail(BOT_LOGO);
    const second = await logoThumbnail(BOT_LOGO);
    assert.ok(Buffer.isBuffer(first.thumbnail));
    assert.equal(first.thumbnail, second.thumbnail);
    assert.equal(first.thumbnailUrl, undefined);
    const metadata = await sharp(first.thumbnail).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.ok(metadata.width <= 320 && metadata.height <= 320);
});

test("custom remote bot pictures continue to use thumbnail URLs", async () => {
    const url = "https://example.com/custom-logo.png";
    assert.deepEqual(await logoThumbnail(url), { thumbnailUrl: url });
});

test("explicit thumbnails override the saved bot picture", async () => {
    const thumbnail = Buffer.from("synthetic thumbnail");
    assert.deepEqual(await logoThumbnail(BOT_LOGO, thumbnail), { thumbnail });
});
