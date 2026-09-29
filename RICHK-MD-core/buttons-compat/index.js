"use strict";

function describeCta(button) {
    try {
        const params = JSON.parse(button.buttonParamsJson || "{}");
        const label = params.display_text || button.name || "Action";
        const value = params.url || params.copy_code;
        return value ? `${label}: ${value}` : label;
    } catch {
        return button.text || button.name || "Action";
    }
}

async function sendButtons(Gifted, jid, options = {}) {
    const {
        title,
        text = "",
        footer,
        image,
        buttons = [],
        ...extra
    } = options;

    const content = {
        ...extra,
        text: title ? `${title}\n\n${text}`.trim() : text,
        ...(footer ? { footer } : {}),
        ...(image ? { image } : {}),
    };

    const legacyButtons = buttons
        .filter((button) => button && typeof button.id === "string")
        .map((button) => ({
            buttonId: button.id,
            buttonText: { displayText: String(button.text || button.id) },
            type: 1,
        }));

    if (legacyButtons.length) {
        content.buttons = legacyButtons;
    }

    const ctas = buttons.filter((button) => button && !button.id);
    if (ctas.length) {
        content.text = [
            content.text,
            ...ctas.map(describeCta),
        ].filter(Boolean).join("\n\n");
    }

    return Gifted.sendMessage(jid, content);
}

module.exports = { sendButtons };