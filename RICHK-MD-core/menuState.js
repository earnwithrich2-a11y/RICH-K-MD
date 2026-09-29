const pendingMenus = new Map();
const MENU_TTL_MS = 5 * 60 * 1000;

function menuKey(chatJid, senderJid) {
    return `${chatJid || ""}|${senderJid || ""}`;
}

function rememberMenu(chatJid, senderJid, categories) {
    pendingMenus.set(menuKey(chatJid, senderJid), {
        categories: [...categories],
        expiresAt: Date.now() + MENU_TTL_MS,
    });
}

function selectMenuCategory(chatJid, senderJid, input) {
    const key = menuKey(chatJid, senderJid);
    const pending = pendingMenus.get(key);
    if (!pending) return null;

    if (pending.expiresAt <= Date.now()) {
        pendingMenus.delete(key);
        return null;
    }

    const choice = Number.parseInt(String(input).trim(), 10);
    if (!Number.isInteger(choice)) return null;

    if (choice < 1 || choice > pending.categories.length) {
        return {
            invalid: true,
            total: pending.categories.length,
        };
    }

    pendingMenus.delete(key);
    return {
        category: pending.categories[choice - 1],
    };
}

module.exports = {
    rememberMenu,
    selectMenuCategory,
};