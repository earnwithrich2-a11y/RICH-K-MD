# RICHK-MD

RICHK-MD is a multi-device WhatsApp bot with fast, non-blocking command reactions.

The source is organized into `RICHK-MD-core` (runtime, settings and local data) and
`RICHK-MD-commands` (WhatsApp commands). Runtime session and database files stay in
`RICHK-MD-core` and are not committed to Git.

<details>
<summary>GET YOUR SESSION_ID</summary>
<a href="https://rich-k.onrender.com/"><img src="https://img.shields.io/badge/CLICK%20HERE-green" alt="Pairing Code" width="150"></a>

</details>

(A) HEROKU DEPLOYMENT

<details>
<summary>TAP TO OPEN</summary>
<a href="https://signup.heroku.com/login"><img src="https://img.shields.io/badge/HEROKU%20SIGNUP-white" alt="Heroku Signup" width="150"></a>
  
<a href="https://dashboard.heroku.com/new?template=https://github.com/earnwithrich2-a11y/RICH-K-MD"><img src="https://img.shields.io/badge/DEPLOY%20NOW-red" alt="Deploy on Heroku" width="150"></a>

- PostgreSQL is auto-provisioned via the heroku-postgresql:essential-0 addon — no manual setup needed.
- All environment variables are pre-filled from app.json. Just add your SESSION_ID.
</details>

## Setup

1. Install Node.js 20.19 or newer (CommonJS plugins use Node's supported ESM interoperability).
2. Install dependencies:

   ```bash
   npm install
   ```

   `.npmrc` enables legacy peer-dependency resolution for hosting builds.
   The WhatsApp SDK is pinned to the version matching the checked-in security
   patches; do not update it without updating and testing those patches.

   After installing dependencies in Replit, normalize the generated lockfile
   before committing or deploying:

   ```bash
   npm run lockfile:portable
   ```

   Before a subsequent clean install in Replit, use
   `npm run lockfile:portable -- --replit` to retain the package firewall's
   required `/npm/` download prefix. After installation, run the portable
   command again. This changes download URLs only, not versions or integrity
   hashes. Heroku uses the committed public-registry URLs directly.

3. Add `SESSION_ID` through Replit Secrets or your hosting provider.
4. Start RICHK-MD:

   ```bash
   npm run dev
   ```

## Owner maintenance commands

- `.restart` acknowledges the request, waits two seconds, saves the current auth
  state, closes the WhatsApp transport without logging out, and exits cleanly.
  PM2 or the bundled supervisor starts the bot again with the existing session.
- `.update` requires a writable Git checkout on `main` with a configured `origin`.
  It fetches and fast-forwards only, refusing local tracked changes, divergent
  history, or updates that modify session files, environment files or runtime
  databases. Dependencies are installed only when dependency/install inputs change.
  Installation errors are reported without requesting a restart.

Only the configured owner, connected WhatsApp account or explicitly configured
sudo users can run these commands. General developer/super-user privileges are
not sufficient. Neither command deletes session files or calls WhatsApp logout.

Deployments without `.git` metadata must redeploy the latest GitHub `main` for
code updates; `.update` reports this clearly. `.restart` still works under the
configured supervisor. Run only one bot instance per WhatsApp session.

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
