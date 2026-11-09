---
name: View-once recovery and privacy
description: Why opened view-once recovery needs saved originals, and why manual recovery must stay in private inboxes.
---

Manual view-once recovery must send recovered media to the requester's private
inbox, never fall back to posting it into the source group/chat.

**Why:** The user explicitly clarified that `.vv` and `.👍` must keep recovered
images, videos and audio private, including when invoked in a group.

**How to apply:** Resolve the private recipient before downloading and preserve
existing access checks. Failed private delivery is not permission to send publicly.

Opening a view-once message on a phone can leave its quote without download
metadata. Recovery may still work from a saved original or previously downloaded
bytes, but cannot be guaranteed after both the bot's copy and server media are gone.

**Why:** Quoted metadata alone produced missing-URL/directPath errors. Recovery
archives may also unwrap the original envelope, losing the wrapper-only view-once
marker even while retaining the media and bytes.

**How to apply:** Use chat-scoped original lookups, combine the quote's marker
with the saved original's media type, prefer existing bytes, and attempt native
media refresh only when keys are available. Never search by message ID across
unrelated chats or promise reconstruction of media the bot never received.

An unavailable/expired reply is not evidence that the sender opened the media.

**Why:** The user reported the same failure in self-chat, peer chats and groups.
Regression cases reproduced failures even with a usable original or quote:
incomplete/stale sources could hide complete copies, and self-chat address
changes could miss a saved original.

**How to apply:** Reproduce source-selection failures before changing retention
or blaming expiry. Preserve complete alternative sources without mixing keys and
paths from different versions. Use both authenticated self identities only for a
genuine self-chat, not merely because a peer-chat command is outgoing. Diagnose
missing keys separately from download errors without logging private metadata.

Some SDK message-level download helpers reject media that has only directPath,
despite the content-stream downloader supporting that path.

**Why:** This mismatch exists in the tested official transport; substituting one
helper for the other can reintroduce failures for otherwise downloadable media.

**How to apply:** Verify the installed helper's accepted inputs before changing
download APIs; preserve full-buffer and directPath-only regression tests.

Do not treat the generic store's latest record or a stripped quote as the only
source of View-Once decryption metadata.

**Why:** The user specifically identified quote stripping of mediaKey/directPath
and requested a separate incoming-message metadata cache lasting at least 15 minutes.

**How to apply:** Capture full envelopes synchronously before other listeners can
normalize them; preserve good keys against stripped retransmissions. Look up the
normal chat-scoped store first, then the independent snapshot. Socket reconnection
must not shorten the process-wide retention window or change private delivery.

Keeping full keys is not equivalent to keeping recoverable media bytes.

**Why:** The user still received an unavailable-media result after metadata
caching was added. Server access can disappear after opening; outgoing mirrors
also use device-sent wrappers and do not enter the incoming-only recovery archive.

**How to apply:** Test with server downloads unavailable after the original was
received. Byte prefetch must be bounded, short-lived and private,
with no automatic forwarding. Preserve Anti-Delete's own-message exclusions;
support linked-device envelopes in the separate manual View-Once path instead.

Private background View-Once caching defaults ON for all chats, with no manual
enable command required. Keep an explicit OFF choice available and persistent.

**Why:** The user explicitly requested default-true caching so users never have
to run `.vvcache on` manually. This supersedes the previous opt-in caching rule,
not the OFF defaults for unrelated automation or automatic media forwarding.

**How to apply:** Apply the default to both fresh and existing installations
once, then respect later owner OFF choices across restarts. Cache keys and bytes
in the background without adding automatic sends or changing `.vv` privacy.

The user confirmed their active bot runs on another host, not this workspace.

**Why:** They identified the source of the unavailable-media screenshot when
asked where that bot was running.

**How to apply:** Verify the currently running host/version before attributing
its behavior to workspace login state. A GitHub push does not itself load code on
that other host; distinguish local tests from live-host delivery verification.
