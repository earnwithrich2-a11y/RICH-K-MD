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

Some SDK message-level download helpers reject media that has only directPath,
despite the content-stream downloader supporting that path.

**Why:** This mismatch exists in the tested official transport; substituting one
helper for the other can reintroduce failures for otherwise downloadable media.

**How to apply:** Verify the installed helper's accepted inputs before changing
download APIs; preserve full-buffer and directPath-only regression tests.
