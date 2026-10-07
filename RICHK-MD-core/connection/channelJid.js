// Channel posts do not establish a personal owner identity. This exception
// permits only displaying the current channel's public ID, never lookups
// or owner privileges.
function canShowCurrentChannelJid(from, command, input) {
    return (
        typeof from === "string" &&
        /^\d+@newsletter$/.test(from) &&
        command === "jid" &&
        (input == null || (typeof input === "string" && input.trim() === ""))
    );
}

module.exports = { canShowCurrentChannelJid };
