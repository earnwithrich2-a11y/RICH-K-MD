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
