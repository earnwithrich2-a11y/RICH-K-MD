---
name: View-once recovery and privacy
description: Why opened view-once recovery needs saved originals, and why manual recovery must stay in private inboxes.
---

Manual view-once recovery must send recovered media only to the connected bot
owner's private inbox, never to the requester or source group/peer.

**Why:** The user requires owner-only delivery and clean target chats, and has
since asked for direct quoted-media downloads without pre-download key notices.

**How to apply:** Resolve the connected owner before downloading and preserve
owner/approved-sudo command access. Do not send success notices, error text,
prefix reactions or reveal reactions into the source chat. Try the quoted media
with Baileys first; cache lookups are fallbacks, never prerequisites. Send an
error only when the downloader actually fails, and only to the connected owner's
DM. Owner-authored 👍 reactions may trigger saving, but bot-generated reaction
echoes must not loop.

Opening a view-once message on a phone can leave its quote without download
metadata. Recovery may still work from a saved original or previously downloaded
bytes, but cannot be guaranteed after both the bot's copy and server media are gone.

**Why:** Quoted metadata alone produced missing-URL/directPath errors. Recovery
archives may also unwrap the original envelope, losing the wrapper-only view-once
marker even while retaining the media and bytes.

**How to apply:** Use ID-only manual recovery caches, combine the quote's marker
with the saved original's media type, prefer existing bytes, and attempt native
media refresh only when keys are available. Do not generalize this manual cache
policy to Anti-Delete or Signal resends, and never promise reconstruction of media
the bot never received.

An unavailable/expired reply is not evidence that the sender opened the media.

**Why:** The user reported the same failure in self-chat, peer chats and groups.
Regression cases reproduced failures even with a usable original or quote:
incomplete/stale sources could hide complete copies, and self-chat address
changes could miss a saved original.

**How to apply:** Reproduce source-selection failures before changing retention
or blaming expiry. Preserve complete alternative sources without mixing keys and
paths from different versions. Keep manual ID lookup independent of JID spelling,
while restricting all delivery to the connected owner. Diagnose
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
independent snapshot by target message ID alone first, then durable stores. Socket reconnection
must not shorten the process-wide retention window or change private delivery.

The manual View-Once cache must use message IDs alone, not chat+ID keys or a
chat-filtered sub-index. This also applies to cached bytes and pending downloads.

**Why:** The user explicitly requested direct ID lookup to avoid JID/LID mismatch
in all chats. This supersedes the earlier manual chat-scoping rule.

**How to apply:** Extract the target stanza ID for commands/reactions and consult
the owner-only ID Map directly. Preserve collision safety, expiry and byte limits
without reintroducing a JID requirement.

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
