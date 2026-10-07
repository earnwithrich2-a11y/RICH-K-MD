# RICHK-MD

RICHK-MD is a multi-device WhatsApp bot with fast, non-blocking command reactions.

The source is organized into `RICHK-MD-core` (runtime, settings and local data) and
`RICHK-MD-commands` (WhatsApp commands). Runtime session and database files stay in
`RICHK-MD-core` and are not committed to Git.

(A) HEROKU DEPLOYMENT

<details>
<summary>TAP TO OPEN</summary>
<a href="https://signup.heroku.com/login"><img src="https://img.shields.io/badge/HEROKU%20SIGNUP-white" alt="Heroku Signup" width="150"></a>
  
<a href="https://dashboard.heroku.com/new?template=https://github.com/earnwithrich2-a11y/RICH-K-MD"><img src="https://img.shields.io/badge/DEPLOY%20NOW-red" alt="Deploy on Heroku" width="150"></a>

- PostgreSQL is auto-provisioned via the heroku-postgresql:essential-0 addon — no manual setup needed.
- All environment variables are pre-filled from app.json. Just add your SESSION_ID.
</details>

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
