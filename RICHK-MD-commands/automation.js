const { gmd } = require("../RICHK-MD-core/gmdCmds");
const { getAllSettings, setSetting } = require("../RICHK-MD-core/database/settings");
const { setGroupSetting } = require("../RICHK-MD-core/database/groupSettings");
const { getGroupMetadata } = require("../RICHK-MD-core/connection/groupCache");
const { getGroupRole, botIdentities, senderIdentities } = require("../RICHK-MD-core/groupLinkLock");
const { isMaintenanceOwner, DENIED } = require("../RICHK-MD-core/connection/maintenance");
const { connectedUserJid } = require("../RICHK-MD-core/connection/messageRecovery");
const { mediaContent } = require("../RICHK-MD-core/connection/automationMedia");

for (const pattern of ["faketyping", "fakerecording", "alwaysonline", "antiviewonce"]) {
    gmd({ pattern, ...(pattern === "antiviewonce" ? { aliases: ["antivv"] } : {}),
        category: "owner", description: `${pattern} on/off (owner only).`, filename: __filename },
    async (from, socket, context) => {
        if (!await isMaintenanceOwner(socket, context)) return context.reply(DENIED);
        const value = (context.q || "").trim().toLowerCase();
        if (!["on", "off"].includes(value)) return context.reply(`Usage: .${pattern} on/off`);
        const enabled = value === "on";
        if (["faketyping", "fakerecording"].includes(pattern)) {
            const mode = pattern === "faketyping" ? "typing" : "recording";
            const settings = await getAllSettings();
            for (const key of ["DM_PRESENCE", "GC_PRESENCE"]) {
                if (enabled || settings[key] === mode) await setSetting(key, enabled ? mode : "offline");
            }
            if (!enabled && /@(g\.us|s\.whatsapp\.net|lid)$/.test(from)) {
                await socket.sendPresenceUpdate("paused", from).catch(() => {});
            }
        } else {
            await setSetting(pattern === "alwaysonline" ? "ALWAYS_ONLINE" : "ANTIVIEWONCE",
                pattern === "antiviewonce" ? (enabled ? "indm" : "off") : String(enabled));
            if (pattern === "alwaysonline" && !enabled) {
                await socket.sendPresenceUpdate("unavailable").catch(() => {});
            }
            await socket.optionalAutomation?.syncOnline();
        }
        return context.reply(`${pattern} is ${value.toUpperCase()}.${pattern === "antiviewonce" && enabled ?
            " Incoming view-once media will be saved to the connected bot account’s DM." : ""}`);
    });
}

gmd({ pattern: "antikick", category: "group", description: "Restore removed members while the bot remains an admin.",
    filename: __filename }, async (from, socket, context) => {
    if (!context.isGroup) return context.reply("This command only works in groups.");
    const value = (context.q || "").trim().toLowerCase();
    if (!["on", "off"].includes(value)) return context.reply("Usage: .antikick on/off");
    try {
        const metadata = await getGroupMetadata(socket, from, { forceRefresh: true });
        const role = getGroupRole(metadata, senderIdentities(socket, context.mek, [context.sender]));
        if (!role.isAdmin && !role.isOwner) return context.reply("Only group admins and the group owner can change anti-kick.");
        const bot = getGroupRole(metadata, botIdentities(socket));
        if (value === "on" && !bot.isAdmin && !bot.isOwner) return context.reply("Make the bot a group admin first.");
        await setGroupSetting(from, "ANTIKICK", String(value === "on"));
        return context.reply(`Anti-kick is ${value.toUpperCase()}.` + (value === "on" ?
            " It attempts to restore removed members. It cannot restore the bot after removal; WhatsApp may also require a member’s approval." : ""));
    } catch { return context.reply("Could not update anti-kick. Please try again."); }
});

gmd({ pattern: "savestatus", aliases: ["downloadstatus", "statusdl"], category: "owner",
    description: "Reply to a status to save its media/text to the connected account’s DM.",
    filename: __filename }, async (_from, socket, context) => {
    if (!await isMaintenanceOwner(socket, context)) return context.reply(DENIED);
    const info = context.mek?.message?.extendedTextMessage?.contextInfo;
    let content = info?.quotedMessage || context.quoted?.message;
    for (let depth = 0; content?.ephemeralMessage?.message && depth < 6; depth++) content = content.ephemeralMessage.message;
    if (!content) return context.reply("Reply to a status photo, video, audio or text with .savestatus.");
    const target = connectedUserJid(socket);
    if (!target) return context.reply("The connected account is unavailable.");
    try {
        const mediaType = ["imageMessage", "videoMessage", "audioMessage", "stickerMessage"].find(key => content[key]);
        if (mediaType) return await socket.sendMessage(target, await mediaContent(mediaType, content[mediaType]));
        const text = content.conversation || content.extendedTextMessage?.text;
        if (text) return await socket.sendMessage(target, { text });
        return context.reply("This status type is not supported.");
    } catch { return context.reply("Could not save this status. Its media may have expired; try a fresh status."); }
});
