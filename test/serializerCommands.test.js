const test = require("node:test");
const assert = require("node:assert/strict");
const { serializeMessage } = require("../RICHK-MD-core/connection/serializer");

const bot = { user: { id: "synthetic-bot:7@s.whatsapp.net", lid: "synthetic-own:7@lid" } };

test("a known other person's LID and alternate phone address retain their destination", async () => {
  const ms = {
    key: { remoteJid: "synthetic-friend@lid", remoteJidAlt: "synthetic-friend@s.whatsapp.net", fromMe: true },
    message: { conversation: ".ping" },
  };
  const result = await serializeMessage(ms, bot);
  assert.equal(result.from, "synthetic-friend@lid");
  assert.equal(result.sender, "synthetic-bot@s.whatsapp.net");
  assert.equal(result.messageAuthor, "synthetic-bot@s.whatsapp.net");
});

test("actual phone and LID self-chat identities retain their routing", async () => {
  for (const remoteJid of ["synthetic-bot@s.whatsapp.net", "synthetic-own@lid"]) {
    const result = await serializeMessage({
      key: { remoteJid, fromMe: true }, message: { conversation: ".ping" },
    }, bot);
    assert.equal(result.from, "synthetic-bot@s.whatsapp.net");
  }
});

test("disappearing commands preserve quotes, mentions and the original message", async () => {
  const original = {
    key: { remoteJid: "synthetic-friend@s.whatsapp.net", fromMe: true },
    message: {
      ephemeralMessage: {
        message: {
          extendedTextMessage: {
            text: ".love",
            contextInfo: {
              quotedMessage: { conversation: "hello" },
              participant: "synthetic-friend@s.whatsapp.net",
              stanzaId: "synthetic-quoted",
              mentionedJid: ["synthetic-friend@s.whatsapp.net"],
            },
          },
        },
      },
    },
  };
  const result = await serializeMessage(original, bot);
  assert.equal(result.body, ".love");
  assert.equal(result.command, "love");
  assert.equal(result.type, "extendedTextMessage");
  assert.equal(result.ms, original);
  assert.deepEqual(result.quoted, { conversation: "hello" });
  assert.deepEqual(result.mentionedJid, ["synthetic-friend@s.whatsapp.net"]);
  assert.equal(result.quotedKey.id, "synthetic-quoted");
  assert.equal(result.quotedKey.fromMe, false);
  assert.ok(original.message.ephemeralMessage);
});
