---
name: Linked-device certificate prefixes
description: Why a valid account certificate can coexist with a legacy, incompatible linked-device signature.
---

Do not choose the linked-device signature prefix from the account hosting type. Current upstream signing uses the device prefix `[6, 1]`; account-signature verification separately uses the decoded device type.

**Why:** A preserved login had valid identity, noise, pre-key and account signatures, but its linked-device certificate verified only under the old fork's `[6, 6]` prefix. The fork incorrectly selected that prefix from the outer hosted-account flag. Upgrading the SDK did not regenerate the imported device certificate, so recipient retries continued.

The user confirmed on 2026-10-13 that a fresh `.ping` bot reply was readable on the other person's phone after correcting the device signature while preserving the login. This confirms that private-chat text-reply flow, not recovery of every historical pending message or every media command.

**How to apply:** Normalize protobuf JSON byte fields before verification; they can be base64 strings rather than Buffers. A narrowly recognized legacy device signature can be re-signed with the existing device private key after verifying the account certificate and verifying the resulting signature against the existing public key. Preserve account details, account signature, identity keys and login. Reject unknown invalid certificates without rewriting them. Verify the exact serialized device-identity bytes, and still require phone-side confirmation before declaring unreadable replies fixed.
