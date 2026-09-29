const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const pluginPath = require.resolve("../RICHK-MD-commands/social");
const registered = [];
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (
    parent?.filename === pluginPath &&
    request === "../RICHK-MD-core/gmdCmds"
  ) {
    return {
      gmd: (metadata, handler) => registered.push({ metadata, handler }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  require(pluginPath);
} finally {
  Module._load = originalLoad;
}

const expectedReplies = {
  love: "❤️ Sending love and good vibes your way!",
  goodnight: "🌙 Good night! Rest well and wake up refreshed.",
  goodmorning: "🌅 Good morning! Wishing you a bright, happy day!",
};

for (const [pattern, text] of Object.entries(expectedReplies)) {
  test(`.${pattern} sends its greeting to the current chat`, async () => {
    const command = registered.find(({ metadata }) => metadata.pattern === pattern);
    assert.ok(command, `.${pattern} should be registered`);

    const sent = [];
    await command.handler("chat@s.whatsapp.net", {
      sendMessage: async (...args) => sent.push(args),
    });

    assert.deepEqual(sent, [["chat@s.whatsapp.net", { text }]]);
  });
}