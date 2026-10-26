# Optional-feature audit

## Findings before this update

The active plugins are in `RICHK-MD-commands`; the active settings database is
`RICHK-MD-core/database/settings.js`. Root-level duplicate command files are not
loaded by the application and were left alone.

| Requested feature | Existing implementation | Work completed |
| --- | --- | --- |
| Auto-view status | `.autoviewstatus` / `setautoreadstatus` | OFF defaults, full batches, replay/rate controls |
| Auto-like status | `.autolikestatus` | Retained emoji configuration and view-before-like dependency; bounded traffic |
| Download status | Generic `.save` supports quoted media | Added `.savestatus`, `.downloadstatus`, `.statusdl` |
| Anti-view-once | Manual `.vv`; unused automatic helper | Connected automatic saving behind `.antiviewonce on/off` / `.antivv` |
| Fake typing/recording | Existing DM/group presence modes | Added `.faketyping on/off`, `.fakerecording on/off`; no duplicate presence listener |
| Always online | Connect-time availability only | Added `.alwaysonline on/off`, periodic refresh and clean disconnect cleanup |
| Media downloaders | `.play` / `.ytmp3`, `.ytmp4`, `.tiktok`, `.ig` / `.instagram` | Preserved existing implementations |
| Anti-kick | None | Added `.antikick on/off`, stored separately for each group |
| Auto-react | `.autoreact` with modes; first message only, broken commands mode | Fixed full batches, LID chats, configured-prefix matching, and rate limits |
| Auto-read | `.autoread` existed but ran only after successful command lookup | Now processes normal incoming messages independently of command execution |
| AI chat | `.ai`, `.gpt`, other model commands | Preserved existing provider integration |

## Controls and safety

- A one-time rollout turns the listed optional automations OFF, including old
  enabled defaults. Later choices persist across restarts. Anti-Delete, Anti-Edit,
  URL lock, anti-link and other existing protection settings are not reset.
- Bot-wide settings and status saving require the connected account, configured
  owner or approved sudo identity. Anti-kick requires group admin/owner rights;
  enabling it also requires the bot to be an admin.
- Auto-like requires `.autoviewstatus on`. Use `.statusemojis ❤️,💛` to select emojis.
- `.autoreact on/off` and `.autoread on/off` retain their existing additional
  `all`, `dm`, `groups`, and `commands` modes.
- Fake typing and recording are mutually exclusive presence states. Existing
  `.dmpresence` and `.gcpresence` controls continue to work.
- Reply to a status in your private chat with `.savestatus`. Text, images, videos
  and audio are supported. Saved copies go only to the connected account's DM.
- Automatic view-once saving also sends only to the connected account's DM.
  It cannot recover media WhatsApp no longer supplies.
- Automatic media downloads are memory-only, limited to 32 MB each, with
  20-second network/stream timeouts, three concurrent downloads and a queue of 32.
  Failures/overflow are logged; no promise of unlimited archival is made.
- Status views: at most 60/minute. Status likes: 20/minute and one per contact per
  10 seconds. Status replies: 10/minute and one per contact per minute.
  Reactions: 30/minute and one per chat per 3 seconds. Reads: 120/minute.
  These are conservative local limits, not guarantees against WhatsApp restrictions.
- Old history, own outgoing messages, edits, protocol messages and reactions do
  not trigger the optional incoming-chat actions. Message replay deduplication
  is bounded; connection close removes listeners and timers.
- Anti-kick is best effort: it attempts to re-add removed members while the bot
  remains an admin. It does not undo removals attributed to this bot, act on
  unattributed removal events, retaliate, promote users or modify other group
  protection settings. Member privacy may require approval. If the bot itself
  is removed, it cannot use group admin privileges to restore itself.

## Verification boundaries

Automated checks cover commands, permissions, toggles, persistent defaults,
batches, safety limits, media conversion, and existing recovery/group protections.
Startup validation loads all active plugins. These checks do not prove a real
phone decrypted a reply, nor guarantee availability of the existing external
AI/media providers. Live WhatsApp checks require an authenticated connection.
