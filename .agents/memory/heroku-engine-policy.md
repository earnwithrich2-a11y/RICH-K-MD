---
name: Heroku engine policy
description: Why the user requires major-specific engine versions and why GitHub must be checked before editing.
---
The user requests Node `20.x` and npm `10.x` (or omission of the npm engine), not `>=` ranges.

**Why:** Heroku failed while trying to bootstrap the literal npm range `>=10.x`. Later GitHub changes reintroduced that range after the earlier fix, so the workspace alone did not reflect the source being deployed.

**How to apply:** Preserve this hosting constraint in future upgrades. Check current GitHub main before changing deployment settings, preserve unrelated remote updates, and keep manifest and lockfile root engines consistent.
