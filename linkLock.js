const { gmd, getGroupMetadata } = require("../RICHK-MD-core");
const { setGroupSetting } = require("../RICHK-MD-core/database/groupSettings");
const { getGroupRole, botIdentities, senderIdentities } = require("../RICHK-MD-core/groupLinkLock");

gmd({
    pattern: "lockurl",
    category: "group",
    description: "Allow group links only from admins and the group owner (.lockurl off to disable).",
}, async (from, Gifted, context) => {
    const { reply, isGroup, q, mek, sender, messageAuthor } = context;
    if (!isGroup) return reply("❌ .lockurl only works in groups.");
    const input = (q || "").trim().toLowerCase();
    if (!["", "on", "off", "true", "false"].includes(input)) {
        return reply("Usage: .lockurl to enable, or .lockurl off to disable.");
    }
    try {
        const metadata = await getGroupMetadata(Gifted, from, { forceRefresh: true });
        if (!metadata?.participants) return reply("❌ Could not verify group permissions. Try again.");
        const role = getGroupRole(metadata, senderIdentities(Gifted, mek, [sender, messageAuthor]));
        if (!role.isAdmin && !role.isOwner) {
            return reply("❌ Only group admins and the group owner can change the URL lock.");
        }
        const enabled = input !== "off" && input !== "false";
        const bot = getGroupRole(metadata, botIdentities(Gifted));
        if (enabled && !bot.isAdmin && !bot.isOwner) {
            return reply("❌ Make the bot a group admin first so it can remove links.");
        }
        await setGroupSetting(from, "LOCKURL", enabled ? "true" : "false");
        return reply(enabled
            ? "🔒 URL lock enabled for this group. Links from ordinary members will be removed. Only group admins and the group owner are exempt.\nUse .lockurl off to disable."
            : "🔓 URL lock disabled for this group. Other anti-link settings are unchanged.");
    } catch {
        return reply("❌ Could not update this group's URL lock. Try again.");
    }
});
