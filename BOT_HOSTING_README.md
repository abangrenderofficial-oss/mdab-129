# MediaX / Bot-Hosting — safe one-time preparation

## Scope & safety
- Source of truth: `abangrenderofficial-oss/mdab-129`, branch `hosting/bothosting-mediax-ready-20261017`.
- Production Railway `main` untouched. No audio/video/HQ/Android/Live Wallpaper algorithm, profile, preset or quality parameter changed.
- The branch only adds a Bot-Hosting HTTP port fallback, preflight, quality SHA guard, boot script, and documentation.
- GitHub Actions still uses `main` for heavy encoding, including Apple Live Photo on macOS. Do not switch worker ref to this branch.
- Existing Turso database, access-control policies, PayPing plans, supporters and statistics remain shared; do NOT create a new database or migrate tables to Bot-Hosting.

## Bot-Hosting deployment config
- GitHub repo: `abangrenderofficial-oss/mdab-129` (public) and branch: `hosting/bothosting-mediax-ready-20261017`.
- Runtime: Node.js **22** on Linux x64.
- Startup command: `sh scripts/bothosting-start.sh`.
- Recommended initial allocation: 3072 MiB RAM, 100% CPU, 8192 MiB storage (review actual load after cutover).
- Activate a public HTTPS domain on the deployment; copy exact HTTPS origin into `PUBLIC_BASE_URL`.
- Server binds `0.0.0.0` on `SERVER_PORT` (or `PORT` for Railway).
- Disable Git auto-pull on reboot until staging validation finishes; pin this branch for the dry run.
- Keep `MEDIAX_HOSTING_STANDBY=true` while Railway runs the production webhook. This suppresses Telegram webhook processing and all scheduled side jobs on the new server.

## ENV
Copy keys from `BOT_HOSTING_ENV.template` into Bot-Hosting Env UI. Use real values from the existing production runtime, never paste secrets to GitHub. If a key is only used for optional features, it can be omitted. Preserve all existing codec-specific/status env overrides **unchanged**.

Required: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SETUP_SECRET`, `BOT_OWNER_ID`, `PUBLIC_BASE_URL`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GITHUB_ACTIONS_TOKEN`, `BAYARCASH_API_SECRET_KEY`, `BAYARCASH_API_TOKEN`, `BAYARCASH_PORTAL_KEY`.

PayPing shared mode: `PAYPING_SHARED_CONFIG_ENABLED=true` only when existing Railway uses it. Use the same Turso / Bayarcash production-or-sandbox environment flags as the running service.

## No-cutover checks (safe with production Railway running)
1. Startup automatically verifies 20 byte-identical protected quality / worker files, Node version, bundled FFmpeg and yt-dlp. It fails closed if required env values are absent.
2. Check the Bot-Hosting log for `[quality-guard] PASS` and `[bothosting-preflight] PASSED`.
3. Check `https://YOUR_DOMAIN/api/health` for `ok:true` and no missingRuntimeEnv. This route is read-only.
4. Check `/api/diagnostic?case=tiktok`, `/api/diagnostic?case=reels`, `/api/diagnostic?case=threads`, `/api/diagnostic?case=youtube`, and `/api/status-diagnostic` on your NEW hosting. Their requests may reach public providers; run a controlled smoke test.
5. Verify Turso, GitHub Actions permissions and Bayarcash callback URL reachability. Do not trigger real payments on production as a test.
6. Do not register Telegram webhook or point Bayarcash callback at Bot-Hosting during these staging checks; Telegram can have only one active webhook.

## Manual cutover (after all checks)
1. Snapshot the exact Railway webhook via Telegram `getWebhookInfo` and keep the prior callback settings for rollback.
2. Set `MEDIAX_HOSTING_STANDBY=false` on the prepared deployment and restart it. Confirm `/api/health` stays healthy; only do this immediately before intentional cutover.
3. In the Bot-Hosting service shell, run `node scripts/register-railway-webhook.mjs`. Despite its legacy name, it uses `PUBLIC_BASE_URL` and preserves pending updates. Run this **only once** during scheduled cutover.
4. Confirm `getWebhookInfo` points to the new HTTPS `/api/telegram` URL. Test normal TikTok, Instagram, Threads, YouTube, Premium+ HQ, Android HQ and native Apple Live Photo using test accounts/controlled content. GitHub heavy worker still runs on `main`.
5. Move Bayarcash callback/return URL only after webhook and smoke validations succeed; check PayPing notification and transaction detail.
6. Keep Railway available for rollback. If Bot-Hosting fails, re-register prior Telegram URL, restore previous Bayarcash callback and set `MEDIAX_HOSTING_STANDBY=true` on the new deployment. Never run two Telegram active webhooks for the same bot token.

## Why older CI runs failed
- CI `Downloader Smoke`, Status HQ and Heavy Limit were targeting unavailable `mdab-129.vercel.app` and returned HTTP 503 — not evidence that Bot-Hosting breaks media quality.
- CI `Verify Apple Live Photo runtime routing` uses a stale exact source-code function signature; do not rewrite live-wallpaper processing to satisfy a stale text assertion. Validate through current production feature path and native macOS worker smoke instead.

## Quality preservation
`node scripts/bothosting-quality-guard.mjs` checks Git blob SHA of all protected processing files against GitHub `main` at `abf3dacfb909930f9f0d28c09c144fd3b8a43877`. No auto-fixes, no transcoding changes, no settings resets. If an intentional new feature later changes protected files, update the baseline deliberately in a separate reviewed change.
