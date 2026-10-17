---
name: Logo generation availability
description: Why basic text logos must not depend on the specialty-effects provider.
---

Keep basic text-logo generation available independently of specialty-effect services, and explicitly distinguish a locally rendered wordmark from an AI illustration or a named external effect.

**Why:** When the user reported that `.logo` could not generate an image, it was only a menu alias, and live requests for two specialty styles each timed out after a minute. The chosen repair provides a real local PNG rather than hiding the outage behind a substituted specialty effect.

**How to apply:** Keep the menu and generation steps clear. Do not silently label a generic local logo as a requested specialty effect. Treat provider availability and actual WhatsApp delivery as separate checks from local rendering tests.

Typing `.logo` alone must show the logo types first; the user then chooses a type and supplies text to generate it.

**Why:** The user explicitly corrected the direct-generation-only behavior and asked for the types to appear when `.logo` is typed.

**How to apply:** Preserve the no-argument menu, with clear prefixed selection commands and text examples. Choosing a type without text should explain how to add the text, not attempt an empty generation.
