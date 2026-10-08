const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { sweetMessages, createMessagePicker } = require("../RICHK-MD-core/sweetMessages");

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

for (const [pattern, messages] of Object.entries(sweetMessages)) {
  test(`.${pattern} sends varied sweet messages to the current chat`, async () => {
    const command = registered.find(({ metadata }) => metadata.pattern === pattern);
    assert.ok(command, `.${pattern} should be registered`);

    const sent = [];
    for (let i = 0; i < messages.length * 3; i++) {
      await command.handler("chat@s.whatsapp.net", {
        sendMessage: async (...args) => sent.push(args),
      });
    }
    for (let i = 0; i < sent.length; i++) {
      const [to, content] = sent[i];
      assert.equal(to, "chat@s.whatsapp.net");
      assert.deepEqual(Object.keys(content), ["text"]);
      assert.ok(messages.includes(content.text));
      if (i > 0) assert.notEqual(content.text, sent[i - 1][1].text);
    }
    for (let i = 0; i < sent.length; i += messages.length) {
      assert.equal(new Set(sent.slice(i, i + messages.length).map(([, content]) => content.text)).size, messages.length);
    }
  });
}

test("a shuffled cycle avoids repeating its last message at the next boundary", () => {
  // The second shuffle would repeat "first" without the boundary swap.
  const samples = [0.999, 0, 0.999];
  const pick = createMessagePicker(["first", "second"], () => samples.shift());
  assert.deepEqual(Array.from({ length: 6 }, pick), [
    "second", "first", "second", "first", "second", "first",
  ]);
});

test("picker rejects pools that cannot provide distinct messages", () => {
  assert.throws(() => createMessagePicker(["only"]));
  assert.throws(() => createMessagePicker(["same", "same"]));
});

test("group replies use the same varied text-only behavior", async () => {
  for (const { handler } of registered) {
    const sent = [];
    const socket = { sendMessage: async (...args) => sent.push(args) };
    await handler("group@g.us", socket);
    await handler("group@g.us", socket);
    assert.equal(sent[0][0], "group@g.us");
    assert.equal(sent[1][0], "group@g.us");
    assert.notEqual(sent[0][1].text, sent[1][1].text);
  }
});