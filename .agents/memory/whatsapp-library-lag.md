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

The user requested the transport alias `"@whiskeysockets/baileys": "npm:bungoma"` and approved carrying encryption protections into that transport. Preserve the active login during upgrades; fresh pairing requires separate approval.

**Why:** Multiple fork patches passed synthetic tests without producing readable phone-side replies. After approving an upstream upgrade, the user requested Bungoma with protections rather than an unprotected package swap.

**How to apply:** Use the requested transport without discarding domain-aware sessions, isolated key transactions, durable-write ordering or live-event protections. Validate the actual selected transport, not a second SDK left installed for tests.

Check registry availability before assuming the installed transport can be reproduced by a clean install.

**Why:** On 2026-10-17, a clean install could not fetch the locked Bungoma release; registry metadata offered only security-placeholder versions. An already working dependency directory did not prove the package was still available.

**How to apply:** Recheck current registry metadata before reinstalling or deploying this fork. Do not vendor withdrawn package copies or bypass the package firewall. Preserve the active login and obtain approval for a supported replacement, since the user explicitly selected this fork.

Device discovery can list hosted device 99 under an ordinary PN/LID parent. Do not infer a hosted Signal address solely from the device number.

**Why:** Live Bungoma resends reached recipient-key preparation but then failed on a non-hosted device-99 target discovered during fan-out. Ordinary phones still need their valid delivery targets; weakening the namespace check is not a safe repair.

**How to apply:** Exclude device 99 from discovery unless the result explicitly uses a hosted namespace. Keep strict address validation and test both ordinary-device exclusion and explicit hosted-device retention.

When moving from a domainless transport to domain-aware Signal addresses, preserving the login is not enough: known legacy LID session and sender-key records also need a non-destructive namespace migration.

**Why:** The old fork stored LID keys under bare identifiers, while upstream looks for domain-qualified identifiers. Otherwise old encryption state remains present but unreadable by the new transport.

**How to apply:** Use verified identity mappings, leave ambiguous identifiers unchanged, retain source records, and never overwrite sessions already advanced by upstream. Seed native mappings with transactional keys rather than a plain key store.

Verify signature checks with both a valid control and a tampered negative control against the actual cryptographic primitive.

**Why:** During certificate diagnostics, the SDK verification wrapper reported success for different message prefixes because it discarded the underlying library's false return value and only handled thrown errors. Strict primitive checks correctly rejected the altered control.

**How to apply:** Do not use the SDK wrapper alone as evidence of valid signatures. For read-only certificate checks, select only public certificate fields, decode base64 byte strings correctly, and never query full credentials or private keys.
