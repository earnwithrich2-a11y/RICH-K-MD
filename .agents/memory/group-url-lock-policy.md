---
name: Group URL lock policy
description: Group roles, not global bot privileges, govern URL-lock exemptions.
---

When `.lockurl` is enabled in a group, only that group's admins and group owner may share links.

**Why:** The user explicitly requested that no one else be able to send links to the group.

**How to apply:** “Owner” means the group owner for this policy. Being the bot owner, a developer, or a sudo user must not grant a link-sharing exemption without the required group role. Keep this strict policy distinct from legacy anti-link modes that have broader exemptions.
