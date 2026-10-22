---
name: Recovery retention policy
description: Recovery retention, private delivery destination and distinction between original author and deletion actor.
---
The user requests a two-hour in-memory cache for incoming originals. Treat that as a RAM retention limit, not permission to delete pending recovery deliveries or shorten the existing disk archive policy.

**Why:** Earlier reliability work retained originals when DM delivery failed. Expiring the RAM copy must not silently cancel those retries. Media bytes remain in the bounded disk archive rather than duplicating whole videos in RAM.

**How to apply:** Expire RAM independently of WhatsApp connectivity, preserve first-original semantics, and keep durable retries after RAM eviction. An ID match alone must not expose another chat's contents; use the conversation or a verified transport-supplied alternate identity.

DM recovery copies belong in the connected bot account's inbox, not a different configured owner's number or every participant's inbox.

**Why:** The user explicitly chose the connected bot account's DM when asked which destination they wanted.

**How to apply:** Resolve the destination from the authenticated account. Do not change it to the owner setting or introduce participant-wide delivery without a new request.

Treat the original author and the deletion actor as separate identities.

**Why:** WhatsApp revoke updates can carry the deleter's outgoing flag even when the deleted original was an incoming message from somebody else.

**How to apply:** Verify the cached original before rejecting an owner-originated deletion event. Preserve the rule against recovering bot-sent originals.
