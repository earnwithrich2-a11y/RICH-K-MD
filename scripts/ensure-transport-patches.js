const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_PATCHES = [
    "@whiskeysockets+baileys+7.0.0-rc14.patch",
    "libsignal+6.0.0.patch",
];

function missingTransportPatches(root = path.resolve(__dirname, "..")) {
    return REQUIRED_PATCHES.filter((name) => {
        try {
            const file = fs.statSync(path.join(root, "patches", name));
            return !file.isFile() || file.size === 0;
        } catch {
            return true;
        }
    });
}

if (require.main === module) {
    const missing = missingTransportPatches(process.argv[2]);
    if (missing.length) {
        console.error(
            `Required WhatsApp fixes are missing: ${missing.join(", ")}. ` +
            "Restore these files in patches/ before starting or installing the bot.",
        );
        process.exitCode = 1;
    }
}

module.exports = { REQUIRED_PATCHES, missingTransportPatches };
