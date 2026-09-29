# Running on Replit

This repository runs as a Node.js 20 WhatsApp bot with a small Express status
page.

## Start command

The **Start application** workflow runs:

```sh
npm run dev
```

The Express server listens on port `5000`. Its health endpoint is `/health`.

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

## Replit compatibility

Replit's package security policy blocks the upstream `gifted-dls` and
`gifted-btns` packages. Downloader commands use direct HTTP APIs instead of
`gifted-dls`. A local `gifted-btns` compatibility package preserves standard
button messages and renders copy/link actions as ordinary message text.
