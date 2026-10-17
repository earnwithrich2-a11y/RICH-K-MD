# Running on Replit

This repository runs as a Node.js 20 WhatsApp bot with a small Express status
page.

## Start command

The **Start application** workflow runs:

```sh
npm run dev
```

The Express server listens on port `5000`. Its health endpoint is `/health`.
The development runner supervises unexpected process failures with a bounded
restart delay. WhatsApp logout/bad-session responses stop reconnection attempts
without deleting login files; `/health` reports `whatsapp.authRequired` and the
status page shows that a valid paired session is needed.

## Pre-publish validation

Run the startup smoke check before publishing or after changing dependencies:

```sh
npm run validate:startup
```

This loads the bot's runtime modules, starts the real Express server in a safe
test mode that does not connect to WhatsApp, and verifies the `/health`
response.

## Configuration

- `SESSION_ID` is required and must be stored as a Replit Secret.
- `MODE`, `TIME_ZONE`, `AUTO_READ_STATUS`, and `AUTO_LIKE_STATUS` are shared
  environment variables.
- `DATABASE_URL` is optional. Without it, the project uses its local SQLite
  database.

Do not commit session data or local database files.

## Message recovery and promotion

Incoming originals are captured synchronously before delete/edit processing.
Recovery sends to the configured `OWNER_NUMBER`, not necessarily the linked bot
account. Owner notifications are sent before media download/upload; failed
deliveries persist and retry. The recovery archive is private local session data:
seven-day retention, 10,000 hot in-memory messages, 32 MiB per media item and a
512 MiB media budget. Pending recoveries are preserved rather than evicted.
Media not received/downloaded before it expires cannot be guaranteed recoverable.
Use encrypted/private hosting storage and disclose message retention to chat users.

The requested public-mode rollout is applied once to existing settings. Owner-only
administration and group-admin permissions remain protected. The promotion footer
is added centrally; audio/stickers receive a separate footer message because
WhatsApp does not support their captions. Reactions, deletes and protocol control
packets are not changed. Promotion commands provide instructions, not a live
balance lookup, payment processing or a guarantee of third-party service availability.

## Replit compatibility

Replit's package security policy blocks the upstream `gifted-dls` and
`gifted-btns` packages. Downloader commands use direct HTTP APIs instead of
`gifted-dls`. A local `gifted-btns` compatibility package preserves standard
button messages and renders copy/link actions as ordinary message text.
