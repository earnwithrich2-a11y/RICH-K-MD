---
name: Bot command readiness
description: Why a connected bot and a healthy web server do not prove command events are being delivered.
---

Treat WhatsApp authentication, message-event delivery, and phone-side reply decryption as separate verification steps.

**Why:** The user reported silent commands while the bot was connected, public and unpaused. A live check showed the startup event buffer still active after more than a minute, with no recent message-handler activity. After bounded startup recovery, the live connection remained authenticated and the buffer was no longer active.

**How to apply:** Check event buffering and command reception before recommending another session ID. Startup recovery must release only the buffering level it owns; late or duplicate sync completion must not release unrelated operations. Readable replies on the user's phone remain a separate verification requirement.
