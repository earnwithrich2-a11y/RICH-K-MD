---
name: Optional automation safety
description: Safety defaults and preservation requirements for feature audits and optional bot automation.
---

Optional status viewing/liking, message reactions/reads, fake presence, always-online
and automatic view-once saving should default OFF and require explicit opt-in.
After the safety rollout, preserve the owner's saved toggle choices across restarts.

**Why:** The user specifically requested OFF defaults to reduce rate-limit risk,
and asked that audits preserve existing working commands, Anti-Delete, Anti-Edit
and group protection behavior rather than duplicating or overwriting them.

**How to apply:** Trace the active loader before adding commands; do not assume
duplicate root-level source files are active. Keep optional activity bounded and
independent of command/recovery intake. Never turn a feature on merely because
legacy defaults were enabled.

Status/view-once saving should not silently republish private media into a group.
Anti-kick must not undo the bot's own moderation or promise restoration after the
bot itself has lost group access.

**Why:** Saving privately avoids exposing media to additional recipients, and
WhatsApp admin permissions cease when the bot is removed. Reversing the bot's
moderation would undermine the user's explicit group-protection constraint.

**How to apply:** Keep private saved copies separate from source-chat replies;
describe restoration limits plainly and retain fail-closed permission checks.
