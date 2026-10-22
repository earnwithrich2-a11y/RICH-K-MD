const { generateMessageIDV2 } = require("gifted-baileys");

const guards = new WeakMap();

// Do not classify messages by SDK-looking ID prefixes: WhatsApp's human
// clients can use those too. Remember only sends made by this socket.
function installAutomatedMessageGuard(socket, maxRemembered = 20000) {
    if (guards.has(socket)) return guards.get(socket);
    const automatedIds = new Set();
    const remember = (id) => {
        if (!id) return;
        automatedIds.add(id);
        while (automatedIds.size > maxRemembered) {
            automatedIds.delete(automatedIds.values().next().value);
        }
    };
    const sendMessage = socket.sendMessage.bind(socket);
    socket.sendMessage = async (jid, content, options = {}) => {
        const messageId = options.messageId || generateMessageIDV2(
            socket.user?.id || socket.authState?.creds?.me?.id,
        );
        // Baileys can emit the outgoing upsert before sendMessage resolves.
        remember(messageId);
        const sent = await sendMessage(jid, content, { ...options, messageId });
        remember(sent?.key?.id);
        return sent;
    };
    const isAutomated = (message) =>
        (message?.key?.fromMe === true && automatedIds.has(message.key.id)) ||
        (message?.isBaileys === true && message?.key?.fromMe !== true);
    guards.set(socket, isAutomated);
    return isAutomated;
}

module.exports = { installAutomatedMessageGuard };
