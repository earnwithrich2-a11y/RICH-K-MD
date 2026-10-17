---
name: Signal transaction safety
description: Why encrypted-message state must use isolated async contexts and atomic durable commits.
---

Cryptographic state changes must have isolated async transaction contexts and a serialized commit boundary. Nested operations may share their own context; unrelated callers must not.

**Why:** A deterministic overlap test showed the old transport reporting success for two operations while losing the second saved session update. Its global nesting counter confused unrelated callers with nested work. Failed storage writes also published uncommitted keys in the cache, and per-row database writes lacked whole-batch rollback.

**How to apply:** Retain atomic key batches, durable-write-before-cache publication, and failure propagation after exhausted commit retries. Session initialization, decryption, encryption and group sender-key changes must participate in the same boundary. Verify with actual receiver decryption, parallel sends, rollback and repository reloads, not only send success.

Do not remove crypto serialization to improve command responsiveness.

**Why:** Cached session snapshots and delayed commits can otherwise reuse counters or overwrite freshly established sessions. Cryptographic correctness and live-event responsiveness are separate concerns.

**How to apply:** Move slow discovery/network work out of critical sections where safe, or prioritize fresh sends over background resends. Keep incoming event processing independent, while preserving the protected cryptographic commit boundary.

Limit the serialized boundary to cryptographic operations and durable key writes, not an entire relay.

**Why:** Whole-relay transactions also covered device discovery, group metadata and socket/network work. Serializing those paths exposed long delays for new replies even though isolated crypto round trips passed.

**How to apply:** Removing an outer relay transaction is safe only when all session initialization, encryption, decryption and group sender-key operations are independently atomic. Test liveness with a deliberately stalled discovery request while a fresh encrypted reply still completes and decrypts. Store private pre-keys before publishing their public counterparts; await the server response outside the key lock.
