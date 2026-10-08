---
name: Outgoing command routing
description: Expected behavior when the linked bot account sends commands to other people's chats.
---

Commands sent by the linked bot account in someone else's chat should reply in that chat, rather than being treated as self-chat.

**Why:** The user specifically requested this behavior after self-chat replies were confirmed. Self-chat-only checks missed problems with disappearing-message envelopes and missing address metadata.

**How to apply:** Keep command-author identity separate from reply destination. Missing aliases must not count as matching identities; retain genuinely verified alternate self-chat addresses. Exercise real message parsing for outgoing commands in both phone-addressed and LID-addressed chats, in public and private mode. Preserve owner permissions and original message metadata when reading wrapped content.
