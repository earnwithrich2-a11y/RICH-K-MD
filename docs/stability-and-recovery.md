# Stability and private recovery

- Anti-Delete and Anti-Edit listen to both message upserts and SDK updates in DMs
  and groups. First originals remain in the existing two-hour memory/durable
  archive. If absent there, lookup starts against `store.loadMessage` before the
  general store processes the update. Only the same chat or an authenticated
  alternate chat is accepted; a failed or stalled lookup does not crash intake.
- Recovery sends only to the connected account's private inbox, including when
  an older configuration selected `inchat`. OFF choices remain respected.
  Notifications use the requested deleted/edited headings, original sender,
  group name or Private DM, and original/edited content. Media retains its type,
  audio voice-note flag and existing durable download/delivery retries.
- `.vv` and `.👍` retain private recipient resolution, full-buffer downloads and
  default-ON background caching. Success replies `✅ View-once sent to your DM.`
  Expired/unavailable media replies `❌ This view-once media has expired or was
  already opened.` Failed downloads, inbox sends, confirmations and reactions
  are contained. No source-chat media fallback is allowed.
- Manual recovery ranks complete originals and quotes rather than letting a
  stripped stored record overwrite good quote metadata. A stale saved download
  can fall back to a complete quote without mixing one version's key with another
  version's path. Incomplete primary records do not hide verified alternate
  copies. Self-chat may use the connected account's authenticated phone/LID aliases;
  outgoing peer/group commands never gain access to its self-chat cache.
  Failed recovery logs only availability flags and HTTP status codes, never media
  keys, URLs or chat identities. The expiry reply alone is not proof of expiry.
- Only disconnect 401 stops automatic reconnection and marks pairing as required.
  Other codes, including 500, 408, 428, 440 and 515, retry after 15 seconds.
  Duplicate closes cannot launch multiple new sockets. Maintenance shutdown
  remains exempt so its supervisor can restart cleanly. No credentials are
  deleted. Do not run competing copies with the same WhatsApp session.
- Socket setup uses `Browsers.macOS('Desktop')` and a guarded store-backed retry
  lookup. Existing crypto, cross-chat retry safeguards and live-event delivery
  protections remain intact. A browser fingerprint does not guarantee avoidance
  of WhatsApp restrictions.
- Ownership follows the connected socket's phone/LID identities rather than
  fixed or previously stored owner numbers. Explicit sudo users remain supported.
  The owner-number command now reports this detected account instead of changing
  who owns it. Reports/requests go to the connected account, not a fixed contact.
  Signal cleanup listeners are installed once rather than on every reconnect.
  Operator shutdown saves auth, closes the socket and exits within a bounded
  grace period; failed cleanup cannot leave the process indefinitely running.

Missing originals cannot be recreated: the bot must have received or saved them,
or WhatsApp must still supply a downloadable original. Tests use isolated stores
and fake sockets; passing tests do not establish phone-side delivery on another
host. That host must install this version before live behavior can be checked.
