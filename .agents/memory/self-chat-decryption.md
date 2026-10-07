---
name: Self-chat decryption verification
description: Verification limits when WhatsApp self-chat replies show "Waiting for this message."
---

A connected WhatsApp session, successful send, successful resend lookup, or passing synthetic tests does not establish that the phone decrypts self-chat replies.

**Why:** The user showed self-chat settings and ping replies stuck at "Waiting for this message" even after a fresh session connected successfully. Previous plain-text/no-reaction experiments and phone-number versus LID routing attempts also did not establish a phone-side fix.

**How to apply:** Preserve the active login while investigating transport behavior. Distinguish verified code changes and connection status from actual phone-side decryption. Do not label this issue resolved without evidence from a fresh reply displayed on the phone; historical pending messages are not a reliable test of new sends.
