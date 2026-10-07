---
name: WhatsApp library lag
description: Why retry investigations must compare the installed fork with current upstream protocol handling.
---

Do not assume that the latest npm release of the current WhatsApp fork includes upstream retry-recovery behavior.

**Why:** During a persistent self-chat decryption investigation, the latest published fork ignored device-provided retry key bundles even though current upstream handled them. Pairing again would not add the missing protocol behavior.

**How to apply:** Compare the installed retry path with upstream when a correctly connected login keeps receiving decryption retries. Prefer a focused, reproducible upstream backport when it preserves existing session and command compatibility; do not replace the active login merely to compensate for missing transport logic.
