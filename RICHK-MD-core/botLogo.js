const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const BOT_LOGO = "RICHK-MD-core/rich-k-logo.png";
const projectRoot = path.resolve(__dirname, "..");
let defaultThumbnail;

async function logoThumbnail(picture = BOT_LOGO, override) {
    const source = override || picture || BOT_LOGO;
    if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
        return { thumbnail: source };
    }
    if (/^https?:\/\//i.test(source)) return { thumbnailUrl: source };
    const file = path.resolve(projectRoot, source);
    const generate = async () => sharp(await fs.readFile(file))
        .resize(320, 320, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
    if (file === path.resolve(projectRoot, BOT_LOGO)) {
        if (!defaultThumbnail) {
            defaultThumbnail = generate().catch((error) => {
                defaultThumbnail = undefined;
                throw error;
            });
        }
        return { thumbnail: await defaultThumbnail };
    }
    return { thumbnail: await generate() };
}

module.exports = { BOT_LOGO, logoThumbnail };
