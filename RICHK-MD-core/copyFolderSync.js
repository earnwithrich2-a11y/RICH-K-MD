const fs = require("fs");
const path = require("path");

function copyFolderSync(source, target, excludeList = [".env"], rootSource = source) {
    if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true });
    }

    for (const item of fs.readdirSync(source)) {
        const srcPath = path.join(source, item);
        const destPath = path.join(target, item);
        const relativePath = path.relative(rootSource, srcPath);
        const shouldExclude = excludeList.some((pattern) =>
            item === pattern ||
            relativePath === pattern ||
            relativePath.startsWith(pattern + path.sep)
        );
        if (shouldExclude) continue;

        if (fs.lstatSync(srcPath).isDirectory()) {
            copyFolderSync(srcPath, destPath, excludeList, rootSource);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

module.exports = { copyFolderSync };