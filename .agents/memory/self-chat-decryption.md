---
name: Self-chat decryption verification
description: Verification limits and the confirmed fresh self-chat text reply result.
---

A connected WhatsApp session, successful send, successful resend lookup, or passing synthetic tests does not establish that the phone decrypts self-chat or private-chat replies.

**Why:** The user showed self-chat settings and ping replies stuck at "Waiting for this message" even after a fresh session connected successfully. Previous plain-text/no-reaction experiments and phone-number versus LID routing attempts also did not establish a phone-side fix.

**How to apply:** Preserve the active login while investigating transport behavior. Distinguish verified code changes and connection status from actual phone-side decryption. Do not label this issue resolved without evidence from a fresh reply displayed on the phone; historical pending messages are not a reliable test of new sends.

A readable human command and an available retry payload do not prove that the bot's encrypted reply is readable.

**Why:** On 2026-10-08, a recipient screenshot showed a readable `.ping` followed by unreadable bot replies. The user subsequently confirmed that a fresh reply still displayed “Waiting for this message” after resend-recovery fixes were activated, despite successful reply lookups.

**How to apply:** Separate command intake, payload recovery, encryption routing, and recipient-side display when evaluating delivery. Keep unresolved recipient delivery explicit; do not use successful recovery lookups as a substitute for phone-side confirmation.

A fresh self-chat text reply was phone-side confirmed; this is historical evidence, not a guarantee of current readiness.

**Why:** On 2026-10-08, the user explicitly confirmed that sending a new `.ping` in their WhatsApp self-chat produced a readable reply. On 2026-10-17, after approving replacement of a logged-out session, the user again confirmed a readable fresh self-chat `.ping` reply with the new login.

**How to apply:** Treat this as evidence for that confirmed flow. Later no-response reports require new runtime checks and a fresh phone-side reply. This confirmation does not establish recovery of older pending messages or delivery of every media, group, or external-service command.

Linked-device retry activity does not by itself prove that the user's phone cannot read replies.

**Why:** The user again confirmed a fresh readable `.ping` after reporting missing replies, while runtime logs contained repeated linked-device retries.

**How to apply:** Use fresh phone-side confirmation for the tested flow, preserve the working login, and identify which device is failing before treating all retry activity as a failure on the user's phone. Do not infer that every linked device or older message has recovered.
