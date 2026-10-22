---
name: Recovery retention policy
description: Distinguishes the user's two-hour RAM cache limit from durable pending delivery retention.
---
The user requests a two-hour in-memory cache for incoming originals. Treat that as a RAM retention limit, not permission to delete pending recovery deliveries or shorten the existing disk archive policy.

**Why:** Earlier reliability work retained originals when DM delivery failed. Expiring the RAM copy must not silently cancel those retries. Media bytes remain in the bounded disk archive rather than duplicating whole videos in RAM.

**How to apply:** Expire RAM independently of WhatsApp connectivity, preserve first-original semantics, and keep durable retries after RAM eviction. An ID match alone must not expose another chat's contents; use the conversation or a verified transport-supplied alternate identity.
