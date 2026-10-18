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

test("own status/notes commands route privately, while another person's status is ignored", async () => {
  for (const key of [
    { fromMe: true },
    { fromMe: false, participant: "synthetic-own@lid" },
  ]) {
    const result = await serializeMessage({
      key: { remoteJid: "status@broadcast", ...key }, message: { conversation: ".ping" },
    }, bot);
    assert.equal(result.from, "synthetic-bot@s.whatsapp.net");
    assert.equal(result.sender, "synthetic-bot@s.whatsapp.net");
    assert.equal(result.isCommand, true);
  }
  assert.equal(await serializeMessage({
    key: { remoteJid: "status@broadcast", participant: "synthetic-friend@s.whatsapp.net", fromMe: false },
    message: { conversation: ".ping" },
  }, bot), null);
});

test("incoming group sender identity is the participant, not the group JID", async () => {
  const result = await serializeMessage({
    key: { remoteJid: "synthetic-group@g.us", participant: "synthetic-friend@s.whatsapp.net", fromMe: false },
    message: { conversation: ".ping" },
  }, bot);
  assert.equal(result.sender, "synthetic-friend@s.whatsapp.net");
  assert.equal(result.from, "synthetic-group@g.us");
});

test("verified native LID mappings resolve the incoming owner's phone identity", async () => {
  const result = await serializeMessage({
    key: { remoteJid: "synthetic-friend@lid", fromMe: false },
    message: { conversation: ".ping" },
  }, {
    ...bot,
    signalRepository: { lidMapping: { getPNForLID: async () => "15550000002@s.whatsapp.net" } },
  });
  assert.equal(result.sender, "15550000002@s.whatsapp.net");
  assert.equal(result.from, "synthetic-friend@lid");
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
