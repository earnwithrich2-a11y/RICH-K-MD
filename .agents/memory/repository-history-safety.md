---
name: Repository history safety
description: Security implications of historical runtime database uploads and limits of a history-preserving merge.
---

Treat historical WhatsApp session databases and message-store databases in the GitHub repository as exposed, even when the current tree no longer tracks them.

**Why:** Manual GitHub uploads included private runtime databases. The merge retained both existing histories rather than rewriting them, so removing these files from the merged tree did not remove their historical copies.

**How to apply:** Never restore authentication or message-store data from Git history into the running bot. Keep live runtime data outside version control. Obtain explicit owner consent before replacing a working WhatsApp login or rewriting published history; those actions have consequences beyond an ordinary source-code merge.
