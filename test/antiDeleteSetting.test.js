const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const pluginPath = require.resolve("../RICHK-MD-commands/settings");
const registered = [];
const writes = [];
let currentValue = "indm";
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
    if (parent?.filename === pluginPath) {
        if (request === "../RICHK-MD-core/gmdCmds") {
            return {
                gmd: (metadata, handler) => registered.push({ metadata, handler }),
                commands: [],
            };
        }
        if (request === "../RICHK-MD-core/database/settings") {
            return {
                getSetting: async () => currentValue,
                setSetting: async (key, value) => {
                    writes.push({ key, value });
                    currentValue = value;
                },
            };
        }
        if (request.startsWith("../RICHK-MD-core/database/")) {
            return {};
        }
    }
    return originalLoad.call(this, request, parent, isMain);
};

try {
    require(pluginPath);
} finally {
    Module._load = originalLoad;
}

const command = registered.find(({ metadata }) => metadata.pattern === "setantidelete");

async function runCommand(input, isSuperUser = true) {
    const replies = [];
    await command.handler("chat@s.whatsapp.net", {}, {
        q: input,
        isSuperUser,
        reply: async (text) => replies.push(text),
        react: async () => {},
    });
    return replies;
}

test("deleted-message recovery command supports owner-only on/off and delivery modes", async () => {
    assert.ok(command);
    assert.ok(command.metadata.aliases.includes("antidelete"));

    currentValue = "false";
    writes.length = 0;
    assert.match((await runCommand("on"))[0], /INDM/);
    assert.deepEqual(writes, [{ key: "ANTIDELETE", value: "indm" }]);

    writes.length = 0;
    assert.match((await runCommand("inchat"))[0], /INCHAT/);
    assert.deepEqual(writes, [{ key: "ANTIDELETE", value: "inchat" }]);

    writes.length = 0;
    assert.match((await runCommand("off"))[0], /OFF/);
    assert.deepEqual(writes, [{ key: "ANTIDELETE", value: "false" }]);

    writes.length = 0;
    assert.match((await runCommand("on", false))[0], /Owner Only/);
    assert.match((await runCommand("not-a-mode"))[0], /Please specify/);
    assert.deepEqual(writes, []);
});