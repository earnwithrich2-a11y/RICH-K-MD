---
name: Self-chat decryption verification
description: Verification limits and the confirmed fresh self-chat text reply result.
---

A connected WhatsApp session, successful send, successful resend lookup, or passing synthetic tests does not establish that the phone decrypts self-chat replies.

**Why:** The user showed self-chat settings and ping replies stuck at "Waiting for this message" even after a fresh session connected successfully. Previous plain-text/no-reaction experiments and phone-number versus LID routing attempts also did not establish a phone-side fix.

**How to apply:** Preserve the active login while investigating transport behavior. Distinguish verified code changes and connection status from actual phone-side decryption. Do not label this issue resolved without evidence from a fresh reply displayed on the phone; historical pending messages are not a reliable test of new sends.

Fresh self-chat text delivery is now phone-side confirmed.

**Why:** On 2026-10-08, the user explicitly confirmed that sending a new `.ping` in their WhatsApp self-chat produced a readable reply.

**How to apply:** Do not continue describing fresh self-chat text replies as unverified unless a new failure is reported. This confirmation does not establish recovery of older pending messages or delivery of every media, group, or external-service command.
