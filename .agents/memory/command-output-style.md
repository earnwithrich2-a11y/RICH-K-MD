---
name: Clean command responses
description: User preference for plain command results and nontechnical update notices.
---
Send command results directly without automatic RICH-K-MD header/footer frames, including text, captions and error notices. Keep existing command functionality intact.

**Why:** The user explicitly requested clean messages rather than the branded top/bottom lines.

**How to apply:** Do not reintroduce automatic result framing. Update notices must avoid GitHub and technical terms, using “🔍 Checking RICH-K-MD servers for updates...”, “📥 Installing latest version...” and “✅ RICH-K-MD is up to date!” for the corresponding states.
