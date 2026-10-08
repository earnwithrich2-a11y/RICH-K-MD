const test = require("node:test");
const assert = require("node:assert/strict");
const { findMessageForRetry, findMessageForRetryWithWait } = require("../RICHK-MD-core/connection/messageRetry");
const { storeLidMapping } = require("../RICHK-MD-core/connection/groupCache");

const own = ["synthetic-own@s.whatsapp.net", "synthetic-own-lid@lid"];
const peerPhone = "synthetic-peer@s.whatsapp.net";
const peerLid = "synthetic-peer-lid@lid";
const saved = {
  key: { id: "synthetic-retry", remoteJid: peerLid, remoteJidAlt: peerPhone, fromMe: true },
  message: { conversation: "Sweet message" },
};
const store = (message = saved) => ({
  async loadMessage() { return null; },
  async loadMessageById() { return message; },
});

test("a verified recipient alternate recovers a DM without redirecting the chat", async () => {
  const result = await findMessageForRetry(store(), {
    remoteJid: peerPhone, id: saved.key.id, fromMe: true,
  }, own);
  assert.equal(result.source, "alternate-private");
  assert.equal(result.isSelfChat, false);
  assert.deepEqual(result.message, saved.message);
});

test("cached verified LID-to-phone mappings permit same-recipient recovery", async () => {
  storeLidMapping(peerLid, peerPhone);
  const result = await findMessageForRetry(store({
    ...saved, key: { ...saved.key, remoteJidAlt: undefined },
  }), { remoteJid: peerPhone, id: saved.key.id, fromMe: true }, own);
  assert.equal(result.source, "alternate-private");
});

test("a matching message ID alone cannot expose another chat's message", async () => {
  for (const [message, requested] of [
    [saved, "synthetic-stranger@s.whatsapp.net"],
    [{ ...saved, key: { ...saved.key, remoteJid: "synthetic-group@g.us" } }, peerPhone],
    [{ ...saved, key: { ...saved.key, fromMe: false } }, peerPhone],
    [{ ...saved, key: { ...saved.key, remoteJid: own[0], remoteJidAlt: peerPhone } }, peerPhone],
  ]) {
    const result = await findMessageForRetry(store(message), {
      remoteJid: requested, id: saved.key.id, fromMe: true,
    }, own);
    assert.equal(result.message, undefined);
  }
});

test("sender metadata is never used as an outgoing recipient alias", async () => {
  const result = await findMessageForRetry(store({
    ...saved, key: { ...saved.key, remoteJidAlt: undefined, senderPn: own[0] },
  }), { remoteJid: own[0], id: saved.key.id, fromMe: true }, own);
  assert.equal(result.message, undefined);
});

test("a DM retry can wait briefly for the outgoing store to finish saving", async () => {
  let reads = 0;
  const result = await findMessageForRetryWithWait({
    async loadMessage() { return ++reads > 1 ? saved : null; },
    async loadMessageById() { return null; },
  }, { remoteJid: peerLid, id: saved.key.id, fromMe: true }, own, [1]);
  assert.equal(result.source, "exact");
  assert.deepEqual(result.message, saved.message);
});
