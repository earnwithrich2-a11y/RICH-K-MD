---
name: Logo generation availability
description: Why basic text logos must not depend on the specialty-effects provider.
---

Keep basic text-logo generation available independently of specialty-effect services, and explicitly distinguish a locally rendered wordmark from an AI illustration or a named external effect.

**Why:** When the user reported that `.logo` could not generate an image, it was only a menu alias, and live requests for two specialty styles each timed out after a minute. The chosen repair provides a real local PNG rather than hiding the outage behind a substituted specialty effect.

**How to apply:** Keep a clear generation command and a separate style menu. Do not silently label a generic local logo as a requested specialty effect. Treat provider availability and actual WhatsApp delivery as separate checks from local rendering tests.
