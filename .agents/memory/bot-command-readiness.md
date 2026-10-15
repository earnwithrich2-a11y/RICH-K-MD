---
name: Bot command readiness
description: Why a connected bot and a healthy web server do not prove command events are being delivered.
---

Treat WhatsApp authentication, message-event delivery, and phone-side reply decryption as separate verification steps.

**Why:** The user reported silent commands while the bot was connected, public and unpaused. A live check showed the startup event buffer still active after more than a minute, with no recent message-handler activity. After bounded startup recovery, the live connection remained authenticated and the buffer was no longer active.

**How to apply:** Check event buffering and command reception before recommending another session ID. Startup recovery must release only the buffering level it owns; late or duplicate sync completion must not release unrelated operations. Readable replies on the user's phone remain a separate verification requirement.

An early clear buffer does not establish lasting readiness: the post-notification app-sync wait can start later, independently of the initial connection buffer.

**Why:** A later inactive report showed an authenticated connection buffering messages again minutes after an initially healthy check. The fork also has an unbounded missing-app-key wait, including when history downloads are disabled.

**How to apply:** Check both synchronization phases. Bound each owned wait separately; duplicate markers must not create new holds, and late key delivery must finish its wait even if the account previously completed an initial sync. Do not reset the login or force-flush unrelated operations to resolve this.

Keep live message delivery independent of background SDK event batching. For this bot, passive phone-account mirroring must not gate commands.

**Why:** Bounded startup recovery was followed by repeated no-response reports with buffering active again. Timers address individual waits, not every long-running buffered operation. The bot does not need passive contact/archive/history mirroring to receive live commands.

**How to apply:** Preserve encryption, authenticated key-share processing, retries, and all command permissions. Deliver live messages and their edits/deletions/receipts without waiting for history or account-state batches; prevent later batch completion from replaying commands. Preserve explicit account-state actions where needed. Verify the dependency honors this configuration, not merely that the socket connected.

Verify the processing path before event emission as well as event delivery. Retry network work must not monopolize incoming-message processing.

**Why:** A no-reply report persisted after live event buffering was disabled. Live inspection found a backlog dominated by receipts waiting alongside incoming messages. Also, “offline” is a transport label: messages sent during reconnection can be new rather than historical.

**How to apply:** Keep retry work ordered per requesting device without making other incoming messages wait for it; retain Signal's cryptographic serialization and key validation. Acknowledge received retry packets independently of slow resends. Use trusted timestamps to distinguish fresh reconnect traffic from history, and prevent a failed packet from leaving a queue permanently marked busy.

Check the offline packet dispatcher as well as receipt and message mutexes.

**Why:** Separating retry work from the live processing mutex does not help if the SDK's outer offline dispatcher still awaits that same retry before forwarding the next message. An exception can also leave its busy flag set indefinitely. This is a demonstrated liveness risk, not by itself proof of the cause of every silent command.

**How to apply:** Route offline receipts through their independent receipt path when live-message prioritization is enabled. Fresh messages need timestamp validation and bypass of the outer history queue, not just promotion to notify after it; otherwise a stalled old placeholder recovery still prevents them from reaching the processing mutex. Preserve crypto serialization and historical-message ordering; catch failures per queued packet and release queue/buffer ownership in finally blocks. Verify with deliberately stalled historical work followed by fresh, old, undated and future-dated messages. These checks establish liveness, not phone-side success.

Do not await phone-side placeholder recovery in the offline message dispatcher.

**Why:** Runtime counters showed encrypted offline packets arriving but no message events or processing-mutex work. Moving unavailable-message recovery to an independently serialized background path drained the offline queue and allowed decrypted messages to reach handlers. Prior receipt isolation and fresh timestamp promotion alone did not restore intake.

**How to apply:** Acknowledge unavailable packets promptly, schedule deduplicated recovery separately, handle background failures, and keep actual Signal operations serialized. Confirm both queue progress and fresh phone-side command behavior; old commands must not replay just because recovery resumes.

The user confirmed a fresh readable self-chat `.ping` on 2026-10-15 after background placeholder recovery was separated from intake.

**Why:** Earlier queue changes passed automated tests but the user still reported no replies. The later runtime evidence showed the backlog draining, fresh events arriving, and then the user explicitly confirmed readable output.

**How to apply:** Treat this as confirmation of that fresh self-chat command only, not of every external-service command, historical message, or peer device. Preserve the working login and recovery isolation.

Distinguish the linked WhatsApp account from the configured bot owner.

**Why:** Owner settings grant command permissions; they do not change the active WhatsApp login. A separate bot account is valid, but self-chat on another account does not reach it.

**How to apply:** Verify masked linked-account metadata and which account the user is testing before attributing missing input to library failures or replacing a login. Do not assume differing owner and bot accounts are themselves a configuration error.
