---
name: Maintenance safety
description: Permission and session-preservation constraints for owner restart/update operations.
---
Maintenance access is limited to the connected account or explicit sudo users,
not a previous configured owner or the bot's broader super-user role.

**Why:** The user now hosts the bot for multiple users and requires dynamic
connected-account ownership without fixed phone privileges. A stored owner from
another deployment is not authorization for the current account.

**How to apply:** Verify identities independently of the broad role flag, fail closed on unknown identities, and never call logout or erase auth state during maintenance.

Code updates must preserve runtime state rather than treating Git as an authentication backup.

**Why:** Historical repository uploads contained session databases; restoring those during an update can expose or replace the active login. Hosts that omit Git metadata also cannot safely perform a normal pull.

**How to apply:** Use inspected fast-forward updates, reject credential/database changes and dirty tracked source, and report unsupported Git-less deployments honestly. Keep clean maintenance exits distinct from an operator-requested supervisor shutdown.
