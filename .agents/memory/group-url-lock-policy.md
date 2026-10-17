---
name: Group URL lock policy
description: Group roles, not global bot privileges, govern URL-lock exemptions.
---

When `.lockurl` is enabled in a group, only that group's admins and group owner may share links.

**Why:** The user explicitly requested that no one else be able to send links to the group.

**How to apply:** “Owner” means the group owner for this policy. Being the bot owner, a developer, or a sudo user must not grant a link-sharing exemption without the required group role. Keep this strict policy distinct from legacy anti-link modes that have broader exemptions.

The smart `.antilink on` policy intentionally exempts the configured bot owner as well as group admins. Global sudo/developer status alone is not an exemption.

**Why:** The user explicitly requested bot-owner exemptions and a private warning for this feature, unlike the earlier strict `.lockurl` requirement.

**How to apply:** Keep the two controls separate. Turning `.antilink off` must not disable `.lockurl`; when both are enabled, preserve the stricter URL-lock policy. Scan the sender's actual reply text, not an innocent reply's quoted original, to avoid punishing members for quoting an admin's link.
