---
name: WhatsApp library lag
description: Why retry investigations must compare the installed fork with current upstream protocol handling.
---

Do not assume that the latest npm release of the current WhatsApp fork includes upstream retry-recovery behavior.

**Why:** During a persistent self-chat decryption investigation, the latest published fork ignored device-provided retry key bundles even though current upstream handled them. Pairing again would not add the missing protocol behavior.

**How to apply:** Compare the installed retry path with upstream when a correctly connected login keeps receiving decryption retries. Prefer a focused, reproducible upstream backport when it preserves existing session and command compatibility; do not replace the active login merely to compensate for missing transport logic.

An empty or missing patch directory is not an error to patch-package, even with its error-on-fail option.

**Why:** It can report success with no patches found, allowing a clean dependency install to silently lose required protocol and safe-logging fixes.

**How to apply:** Verify required compatibility patches exist before invoking the patch installer. Do not classify them as disposable generated files during asset cleanup.

Extending an already-applied dependency patch can leave mixed applied/unapplied hunks that patch-package rejects.

**Why:** The installer checks the complete patch state; rejection in this situation does not by itself mean the new diff is malformed.

**How to apply:** Bring the installed dependency into agreement with the complete patch using focused incremental edits, then verify installer idempotency and check the patch against a clean published package. Keep authentication data untouched.

Device addresses must retain their own phone/LID namespace across discovery and retry routing, rather than inheriting the chat's namespace.

**Why:** The installed fork discarded device namespaces and rebuilt addresses from the enclosing chat. Correcting that alone is insufficient when cached primary devices cause duplicate encryption targets or the sender's LID alias reappears in discovery.

**How to apply:** Review namespace preservation together with cached primary-device filtering, duplicate-target removal, and exclusion of both authenticated sender aliases. Parse primary LIDs as addresses, not with a colon split that can leave the domain attached to the user.

Diagnostic logging must use an explicit allowlist of fixed event names.

**Why:** The transport's original logger accepts objects containing message bodies, personal addresses and key material; enabling generic debug logging to investigate retries can expose them.

**How to apply:** Retain sanitized retry-stage and bundle-status events without forwarding arbitrary SDK objects or error stacks.

Verify signature checks with both a valid control and a tampered negative control against the actual cryptographic primitive.

**Why:** During certificate diagnostics, the SDK verification wrapper reported success for different message prefixes because it discarded the underlying library's false return value and only handled thrown errors. Strict primitive checks correctly rejected the altered control.

**How to apply:** Do not use the SDK wrapper alone as evidence of valid signatures. For read-only certificate checks, select only public certificate fields, decode base64 byte strings correctly, and never query full credentials or private keys.
