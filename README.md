# RICHK-MD

RICHK-MD is a multi-device WhatsApp bot with fast, non-blocking command reactions.

The source is organized into `RICHK-MD-core` (runtime, settings and local data) and
`RICHK-MD-commands` (WhatsApp commands). Runtime session and database files stay in
`RICHK-MD-core` and are not committed to Git.

## Setup

1. Install Node.js 20 or newer.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Add `SESSION_ID` through Replit Secrets or your hosting provider.
4. Start RICHK-MD:

   ```bash
   npm run dev
   ```

## Validation

```bash
npm test
npm run validate:startup
```

## PM2

```bash
npm start
pm2 save
```

Restart RICHK-MD with:

```bash
npm run restart
```

## Commands

Use `.menu` in WhatsApp to view the current RICHK-MD command list.

Use `.done` to confirm that RICHK-MD is active.