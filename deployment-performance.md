# Performance and deployment

## Runtime and installation

Use Node **20.19 or newer in the 20.x line** (the CommonJS/ESM bridge requires
20.19+). `.nvmrc` and `.node-version` select 20.20.0; package engines retain the
requested `>=20.x <22.x` / npm `>=10.x` ranges. Node 21 is not a recommended
deployment target. Node 20 is upstream end-of-life; migration to a maintained
runtime needs separate compatibility testing rather than silently widening
the requested range.

All direct npm packages are exact versions, and `package-lock.json` pins the
transitive tree. Install with `npm ci`, not an unbounded dependency update.
The clean install reports 30 existing npm audit findings (5 low, 3 moderate,
22 high). No transitive lock entries changed in this upgrade. These need a
separate compatibility-tested dependency security update; a successful build
is not a claim that the existing dependency tree is vulnerability-free.
`.npmrc` retains `allow-git=true` and `legacy-peer-deps=true`. These are install
policies, not a guarantee that a registry, GitHub or a binary download is up.

The official `@whiskeysockets/baileys` npm `latest` tag currently resolves to
**7.0.0-rc14**, a release candidate, not a final stable release. Retain this
tested upstream version plus the checked-in transport/libsignal patches.
The local `gifted-baileys` package is only a CommonJS compatibility bridge to
that official SDK; it does not download a separate bot fork.

## Hosts

- Heroku buildpack deployments default to **one worker** in `app.json`.
  `Procfile` provides `worker: node index.js` and an optional web process.
  Scale exactly one process type to one instance; never run a web and worker
  with the same WhatsApp session simultaneously. Existing applications may
  need their formation updated explicitly; changing source does not rescale them.
- Heroku container deployment likewise defines a worker in `heroku.yml`.
- Render keeps its web service and `/health` check. It now installs via `npm ci`.
- Docker copies the local compatibility packages, patches and installer before
  installation. Its context excludes local login databases, credentials and
  node_modules. Build tooling is included for native dependency fallback builds.
- VPS/container entry: `npm start` or `node index.js`. Use an external process
  manager/container restart policy. `npm start:pm2` preserves optional PM2
  operation; the legacy stop/restart scripts apply to that PM2-managed mode.

Keep SESSION_ID and DATABASE_URL in host secrets. Session keys, recovery archives
and SQLite databases need private durable storage. PostgreSQL DATABASE_URL
currently persists application data, **not** the SQLite WhatsApp auth/key files.
Heroku's ephemeral disk cannot preserve those files across dyno replacement;
automatic reconnect does not solve that storage limitation. Use a persistent
disk on a suitable host for durable sessions, or add a tested durable auth
backend before promising uninterrupted Heroku session persistence.

## Responsiveness and safety

- Group metadata is cached for 300 seconds. Concurrent misses share a request;
  failed requests have a short cooldown. Membership/admin update events
  invalidate cached permissions and stale in-flight responses cannot restore them.
- Startup warms command settings and sudo snapshots. Routing never waits for
  their database refresh; successful owner writes update the snapshot immediately.
  External database edits require refresh/restart; use bot settings commands.
- Prefix feedback is a non-blocking ⚡ reaction before LID/metadata lookups.
  Private-mode restrictions and pause still apply. Permission-dependent group
  commands still wait for verified metadata; ordinary ping/menu/settings/alive
  and AI/media categories do not fetch it just to route.
- Heavy AI/download/conversion/search/tools tasks show composing presence.
  Presence failures are cosmetic; overlapping jobs do not prematurely clear it.
- Messages in a batch execute concurrently; a slow AI request cannot hold up ping.
  Own human prefixed commands remain allowed; tracked bot replies and unprefixed
  own messages are ignored.
- `.ping` / `.speed` report actual elapsed **dispatch time**, process uptime,
  host used/total RAM and bot process RSS. Dispatch time is not a fabricated
  delay and is not claimed to be a WhatsApp network round-trip measurement.
- Ordinary text/captions receive a compact non-promotional RICH-K-MD panel.
  Standalone URLs, JSON/code, binary media, controls and original quoted/forwarded
  payloads are not decorated. Unexpected command errors and AI-service failures
  return a polite notice without exposing provider error details.

Run `npm test` and `npm run validate:startup` before deployment. Startup validation
uses safe smoke mode: it checks runtime loading and `/health` without opening a
real WhatsApp session or invoking paid third-party services.
