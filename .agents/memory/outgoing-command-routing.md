---
name: Outgoing command routing
description: Expected behavior when the linked bot account sends commands to other people's chats.
---

Commands sent by the linked bot account in someone else's chat should reply in that chat, rather than being treated as self-chat.

**Why:** The user specifically requested this behavior after self-chat replies were confirmed. Self-chat-only checks missed problems with disappearing-message envelopes and missing address metadata. When adding menu/settings promotion, the user explicitly chose to keep the normal panel in the original chat, visible to both people, rather than redirect it to self-chat.

**How to apply:** Keep command-author identity separate from reply destination. Missing aliases must not count as matching identities; retain genuinely verified alternate self-chat addresses. Exercise real message parsing for outgoing commands in both phone-addressed and LID-addressed chats, in public and private mode. Preserve owner permissions and original message metadata when reading wrapped content.

Retain retry copies of bot-generated messages independently of live message-event delivery, including messages sent to other people's chats.

**Why:** A recipient screenshot showed a readable command followed by unreadable bot messages. Inspection found explicit retry persistence limited to self-chat, and recovery across phone/LID addresses limited to self-chat too. These are recovery gaps, not proof of the initial encryption failure.

**How to apply:** Save outgoing bot messages directly after sending. Alias recovery must prove that the saved message belongs to the same recipient using transport-supplied alternate addresses or verified mappings; a matching message ID alone is insufficient. Never treat outgoing sender metadata as the recipient's identity.

Outgoing resend lookups must verify original ownership even for an exact chat/message-ID match. Preserve legitimate incoming lookups used by other SDK features.

**Why:** The shared message cache contains both sent and received messages. Exact matches previously bypassed the ownership protection present in alternate lookups, making received messages eligible for outgoing resends. The SDK also uses the lookup callback for incoming-message operations, so rejecting every received message would break those consumers.

**How to apply:** Fail closed when an outgoing request matches a record not explicitly marked as sent by the bot; do not wait or fall back to unrelated aliases for that record. Keep incoming lookup behavior intact. Do not assert that this boundary bug explains a live retry storm without correlated evidence.

Unavailable retry plaintext must not trigger encryption-session replacement.

**Why:** The installed transport attempted forced session recovery even when no requested message remained available, producing unnecessary session churn during repeated old receipts.

**How to apply:** Check message availability before key injection or forced session fetches. Bound missing-message attempts and preserve current sessions. Fresh recipient-side readability remains necessary before declaring the delivery issue resolved.
