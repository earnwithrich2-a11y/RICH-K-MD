const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const pluginPath = require.resolve("../RICHK-MD-commands/settings");
const registered = [];
const groupReads = [];
let botSettings = {};
let groupSettings = {};
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
    if (parent?.filename === pluginPath) {
        if (request === "../RICHK-MD-core/gmdCmds") {
            return { gmd: (metadata, handler) => registered.push({ metadata, handler }), commands: [] };
        }
        if (request === "../RICHK-MD-core/database/settings") {
            return { getAllSettings: async () => botSettings };
        }
        if (request === "../RICHK-MD-core/database/groupSettings") {
            return {
                getAllGroupSettings: async (jid) => {
                    groupReads.push(jid);
                    return groupSettings;
                },
            };
        }
        if (request.startsWith("../RICHK-MD-core/database/")) return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};

try {
    require(pluginPath);
} finally {
    Module._load = originalLoad;
}

const command = registered.find(({ metadata }) => metadata.pattern === "settings");

async function menu(isGroup, isSuperUser = true) {
    const replies = [];
    await command.handler("group@g.us", {}, {
        isGroup,
        isSuperUser,
        reply: async (text) => replies.push(text),
        react: async () => {},
    });
    return replies[0];
}

test("settings shows current saved toggles and modes, including this group's values", async () => {
    botSettings = {
        PREFIX: "!",
        AUTO_READ_STATUS: "true",
        AUTO_LIKE_STATUS: "false",
        AUTO_REPLY_STATUS: "false",
        AUTO_REACT: "dm",
        AUTO_REPLY: "true",
        AUTO_READ_MESSAGES: "off",
        AUTO_BIO: "false",
        ANTIDELETE: "indm",
        ANTI_EDIT: "off",
        ANTICALL: "block",
        STARTING_MESSAGE: "true",
        BOT_PAUSED: "false",
    };
    groupSettings = {
        ANTILINK: "warn",
        ANTIBAD: "false",
        WELCOME_MESSAGE: "true",
        GOODBYE_MESSAGE: "false",
        GROUP_EVENTS: "true",
    };

    const text = await menu(true);
    assert.deepEqual(groupReads, ["group@g.us"]);
    for (const [commandName, value] of [
        ["autoviewstatus", "ON"],
        ["autolikestatus", "OFF"],
        ["autoreplystatus", "OFF"],
        ["autoreact", "DM"],
        ["autoreply", "ON"],
        ["autoread", "OFF"],
        ["autobio", "OFF"],
        ["antidelete", "INDM"],
        ["antiedit", "OFF"],
        ["anticall", "BLOCK"],
        ["antilink", "WARN"],
        ["antibad", "OFF"],
        ["welcome", "ON"],
        ["goodbye", "OFF"],
        ["groupevents", "ON"],
        ["startmsg", "ON"],
        ["pause", "OFF"],
    ]) {
        assert.match(text, new RegExp(`\\*\\!${commandName} [^\\n]+\\* — ${value}(?: ·|\\n)`));
    }
});

test("settings in a DM does not pretend group-only settings are off", async () => {
    groupReads.length = 0;
    const text = await menu(false);
    assert.equal(groupReads.length, 0);
    for (const name of ["antilink", "antibad", "welcome", "goodbye", "groupevents"]) {
        assert.match(text, new RegExp(`\\*\\!${name} [^\\n]+\\* — GROUP ONLY`));
    }
});

test("settings still rejects non-owners without reading group settings", async () => {
    groupReads.length = 0;
    assert.match(await menu(true, false), /Owner Only/);
    assert.equal(groupReads.length, 0);
});