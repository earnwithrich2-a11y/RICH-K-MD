---
name: Maintenance safety
description: Permission and session-preservation constraints for owner restart/update operations.
---
Maintenance access is limited to the configured owner, connected account or explicit sudo users, not the bot's broader developer/super-user role.

**Why:** The existing global super-user list includes developer numbers unrelated to owner consent. The user explicitly requires strict owner/connected/sudo authorization for restart and update.

**How to apply:** Verify identities independently of the broad role flag, fail closed on unknown identities, and never call logout or erase auth state during maintenance.

Code updates must preserve runtime state rather than treating Git as an authentication backup.

**Why:** Historical repository uploads contained session databases; restoring those during an update can expose or replace the active login. Hosts that omit Git metadata also cannot safely perform a normal pull.

**How to apply:** Use inspected fast-forward updates, reject credential/database changes and dirty tracked source, and report unsupported Git-less deployments honestly. Keep clean maintenance exits distinct from an operator-requested supervisor shutdown.
