const { gmd, copyFolderSync } = require("../RICHK-MD-core");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

gmd(
    {
        pattern: "update",
        alias: ["updatenow", "updt", "sync", "update now"],
        react: "🆕",
        desc: "Update the bot to the latest version.",
        category: "owner",
        filename: __filename,
    },
    async (from, Gifted, conText) => {
        const {
            q,
            mek,
            react,
            reply,
            isSuperUser,
            setCommitHash,
            getCommitHash,
            botRepo,
        } = conText;

        if (!isSuperUser) {
            await react("❌");
            return reply("❌ Owner Only Command!");
        }

        try {
            if (!botRepo) {
                return reply(
                    "❌ RICHK-MD repository is not configured. Set BOT_REPO first.",
                );
            }

            await reply("🔍 Checking for New Updates...");

            const { data: commitData } = await axios.get(
                `https://api.github.com/repos/${botRepo}/commits/main`,
            );
            const latestCommitHash = commitData.sha;

            const currentHash = await getCommitHash();

            if (latestCommitHash === currentHash) {
                return reply("✅ Your Bot is Already on the Latest Version!");
            }

            const authorName = "RIVO";
            const authorLink = "https://rivo-skills.everyshop.space";
            const commitDate = new Date(
                commitData.commit.author.date,
            ).toLocaleString();
            const commitMessage = commitData.commit.message;

            await reply(
                `🔄 Updating Bot...\n\n*Commit Details:*\n👤 Author: ${authorName}\n🔗 Link: ${authorLink}\n📅 Date: ${commitDate}\n💬 Message: ${commitMessage}`,
            );

            const zipPath = path.join(__dirname, "..", "richk-md-main.zip");
            const { data: zipData } = await axios.get(
                `https://github.com/${botRepo}/archive/main.zip`,
                { responseType: "arraybuffer" },
            );
            fs.writeFileSync(zipPath, zipData);

            const extractPath = path.join(__dirname, "..", "latest");
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(extractPath, true);

            const sourcePath = fs.readdirSync(extractPath)
                .map((entry) => path.join(extractPath, entry))
                .find((entry) =>
                    fs.statSync(entry).isDirectory() &&
                    fs.existsSync(path.join(entry, "index.js")) &&
                    fs.existsSync(path.join(entry, "RICHK-MD-core")) &&
                    fs.existsSync(path.join(entry, "RICHK-MD-commands"))
                );
            if (!sourcePath) {
                fs.unlinkSync(zipPath);
                fs.rmSync(extractPath, { recursive: true, force: true });
                return reply(
                    "❌ This update is not built for RICHK-MD. Choose a repository with the RICHK-MD-core and RICHK-MD-commands folders.",
                );
            }
            const destinationPath = path.join(__dirname, "..");

            const excludeList = [
                ".env",
                "RICHK-MD-core/database/database.db",
                "RICHK-MD-core/database/database.db-wal",
                "RICHK-MD-core/database/database.db-shm",
                "RICHK-MD-core/session",
            ];

            copyFolderSync(sourcePath, destinationPath, excludeList);
            await setCommitHash(latestCommitHash);

            fs.unlinkSync(zipPath);
            fs.rmSync(extractPath, { recursive: true, force: true });

            await reply("✅ Update Complete! Bot is Restarting...");

            setTimeout(() => {
                process.exit(0);
            }, 2000);
        } catch (error) {
            console.error("Update error:", error);
            return reply(
                "❌ Update Failed. Please try by Redeploying Manually.",
            );
        }
    },
);
