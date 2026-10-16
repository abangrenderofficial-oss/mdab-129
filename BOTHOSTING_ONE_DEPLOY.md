# MediaX Bot Hosting — isolated, ONE-deployment package

Source repo: abangrenderofficial-oss/mdab-129
Source branch: **bothosting-ready**, based on production `main` as of 2026-10-15.
**Do NOT point Bot Hosting to main, and do NOT merge this branch into main.**
Railway production is unchanged by this package.

## Server configuration

- Bot Hosting source: GitHub `abangrenderofficial-oss/mdab-129`, branch `bothosting-ready`
- Runtime: **Node.js 22**, Linux x86_64
- Service: HTTP/HTTPS Node application, one replica only
- Entry file: `scripts/bothosting-start.mjs`
- Startup command: `npm install --omit=dev --no-audit --no-fund && exec node scripts/bothosting-start.mjs`
- Minimum practical RAM: **1024 MB** for installation; heavy encoding may need more. Prefer **Pro+ 3 GB** if available.
- Activate a secure `*.apps.bot-hosting.net` domain (or your own HTTPS domain).
- Configure `PUBLIC_BASE_URL` to exactly that new HTTPS origin, no trailing path.
- Disable auto-pull; future pushes to the branch must not restart production.
- Set ENV from `bothosting.env.example`. NEVER paste real credentials in GitHub.

This runtime uses the existing `ffmpeg-static` binary and the added
`ffprobe-static` Node package: **no Docker, root, apt-get or system ffprobe needed**.
`yt-dlp` installs during npm postinstall exactly like Railway's existing resolver.
All download and media encoding code remains from current production main.
This package does not depend on Vercel.

## One-deployment procedure (cutover AFTER preflight)

1. Create **one** Bot Hosting deployment with the branch and startup command above.
   Before first production start, add all required ENV, including the **existing**
   `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; never create a replacement empty database.
   Do not change MediaX's Railway, GitHub Actions or Bayarcash settings.
2. In Bot Hosting shell, validate without starting bot:
   `node scripts/bothosting-start.mjs --config-check`.
   After npm packages/postinstall are installed:
   `node scripts/bothosting-start.mjs --check`.
   Both commands do **NOT** register webhook or contact Telegram/Bayarcash.
3. Verify Bot Hosting external HTTPS domain works and there is sufficient disk/RAM.
   Set `PUBLIC_BASE_URL` to its exact origin. Verify no secrets were placed in GitHub.
4. **Cutover moment only:** stop Railway's active MediaX process/background jobs
   before setting `MEDIAX_BOTHOSTING_ACTIVE=true`,
   `MEDIAX_BOTHOSTING_CUTOVER_APPROVED=true`, and
   `MEDIAX_BOTHOSTING_AUTO_WEBHOOK=true` on Bot Hosting.
5. Start Bot Hosting **once**. It runs dependency checks, starts the current MediaX
   HTTP handlers, polls its own `/api/health`, registers a Telegram HTTPS webhook
   (only with both explicit switches), then verifies it with `getWebhookInfo`.
   Pending Telegram updates are preserved (`drop_pending_updates:false`).
   On later restarts, webhook registration is idempotent.
6. If the flags were left false for staging, start only after cutover approval,
   and optionally run `node scripts/bothosting-webhook.mjs` manually when healthy
   instead of using auto webhook. This is **not a second code deployment**.
7. Smoke-test /start, one video per platform, high quality/Status HQ,
   gallery, live wallpaper, compression, audio/aspect ratio, Bayarcash test flow,
   PayPing three access modes and reminders. Heavy conversions still use
   GitHub Actions worker with existing workflow secrets.

## Safeguards

- Production `main` is not changed. The Railway runtime retains its startup,
  dependencies, webhook, Bayarcash ENV and production traffic throughout preparation.
- The script will NOT start production bot processing if
  `MEDIAX_BOTHOSTING_ACTIVE=true` is absent.
- Telegram webhook will NOT change without both explicit active and cutover approval.
- If `PUBLIC_BASE_URL` is wrong or HTTPS is not reachable, webhook cutover fails.
- Only **one** active production worker per bot token: two separate live HTTP
  instances may duplicate scheduled reminders or payment jobs.
- Reuse production Turso so supporter history, orders, affiliate and usage survive.
- MediaX keeps its **own Bayarcash** integration and callback ownership;
  PayPing continues to own Access Control mode via shared Turso.
- Existing Bayarcash pending-order callbacks may reference the old Railway hostname.
  Keep old callback routing available for those orders until they settle, or
  implement a verified forwarding route before decommissioning its old URL.
  Do not restart the old Railway job scheduler simultaneously.
- GitHub Actions has separate workflow secrets and dispatch limits; copying
  server ENV alone does not replace Actions credentials. Worker ref is still `main`.
- FFmpeg and yt-dlp being present does not guarantee every third-party resolver,
  Telegram upload or 4K job will succeed; real Bot Hosting tests remain mandatory.

## Diagnostics

- `npm run bothosting:config` — syntax and required ENV, no provider calls
- `npm run bothosting:preflight` — dependency binaries + ENV, no webhook
- `npm run check` — inherited MediaX feature regression tests
- `GET /api/health` — verify HTTPS and critical configuration after activation
- `npm run bothosting:webhook` — manually set Telegram webhook only with
  both activation ENV enabled; **never** run during Railway production.

## Hosting limitations / unsupported assumptions

This is a **Bot Hosting Node.js configuration**, not the older Docker GHCR image.
The earlier `prepare-portable-deploy` branch is a separate old snapshot that
does not contain all recent PayPing Access Control changes. **Never deploy it
instead of bothosting-ready**.

One-deploy readiness has three stages: code committed, CI preflight passed, and
production smoke tests passed. The first two do not prove the last one.
