const fs = require("node:fs/promises");
const path = require("node:path");

function connectedUserJid(socket) {
    const id = socket.user?.id || socket.authState?.creds?.me?.id;
    const number = String(id || "").split(":")[0].split("@")[0].replace(/\D/g, "");
    if (!number) throw new Error("Connected WhatsApp user number is unavailable");
    return `${number}@s.whatsapp.net`;
}

async function sendConnectedGreeting(socket) {
    const jid = connectedUserJid(socket);
    const user = jid.split("@")[0];
    const image = await fs.readFile(path.join(__dirname, "..", "rich-k-logo.png"));
    const caption = `╭──────────────━⊷
│ ⚡ *RICH-K-MD CONNECTED!* ⚡
╰──────────────━⊷

✅ *Status:* Online & Active
👤 *Connected User:* @${user}
📌 *Prefix:* .
💡 *Help Menu:* Type *.menu* to view all commands.

📢 *Official Channel:*
https://whatsapp.com/channel/0029VbE9wUJ0Vyc8uRaMNM21

🚀 *Boosting & SMS Portal:*
https://boosting.richkaurex.site

──────────────────
*Powered by RICH-K-MD*`;

    await socket.sendMessage(jid, {
        image,
        caption,
        mentions: [jid],
    });
}

module.exports = { connectedUserJid, sendConnectedGreeting };
