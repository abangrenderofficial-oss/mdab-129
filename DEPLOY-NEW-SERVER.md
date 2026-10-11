# MediaX Downloader — portable one-deploy server handover

## What this prepares
- Docker container with Node.js 22, FFmpeg, ffprobe, ffmpeg-static and the **same existing** yt-dlp installer.
- Startup fail-fast validation of media dependencies and required environment variables (without printing secrets).
- Container health check via /api/health.
- Existing downloader, Status HQ, audio, compression settings and worker code are **unchanged**.
- No automatic deploy of production: this package is built on the prepare-portable-deploy branch.

## Build and preview safely
Run on your own laptop or in Antigravity's terminal:

    docker build -t mediax-ready .
    docker run --rm -p 3000:3000 -e MEDIAX_PREVIEW_MODE=true mediax-ready

IMPORTANT: preview mode requires starting the app WITHOUT production credentials; preflight refuses Telegram, Turso, worker and Bayarcash live secrets in preview. POST operations are read-only blocked. Do not point a local bot at the live Telegram webhook or live Bayarcash account.

## Tested image — deploy ONCE, no build on the new server

The GitHub Actions build passed FFmpeg, yt-dlp, aspect ratio, AAC and read-only preview tests.
The exact tested container image was published to GitHub Container Registry (GHCR):

    ghcr.io/abangrenderofficial-oss/mdab-129:portable-b2a5ecaa4b19

Immutable image digest (best for production):

    ghcr.io/abangrenderofficial-oss/mdab-129@sha256:3676addd3f9e322f4ba329bf836121579b2c2c7827b2919abdc5df16349a76a4

The :portable-ready tag also points to this digest as of the successful build. Prefer the immutable digest so future builds cannot alter deployed media versions.
If the GitHub package is private, make the package public or configure read-only GHCR credentials on the new host. These are registry credentials, separate from MediaX ENV.

## New production server
1. Deploy the tested GHCR image (preferred) OR build the Dockerfile from this branch, as a **single service/replica** with a publicly accessible HTTPS domain. HTTPS is required for Telegram webhook.
2. Set the environment variables in the host's secret settings. Copy names from .env.example, do not commit real values.
3. Required before startup:
   - TELEGRAM_BOT_TOKEN; TELEGRAM_WEBHOOK_SECRET; BOT_OWNER_ID; SETUP_SECRET; PUBLIC_BASE_URL (https://YOUR-DOMAIN)
   - TURSO_DATABASE_URL; TURSO_AUTH_TOKEN (reuse the existing database to preserve historical transactions, supporter, affiliate and follow-up state)
   - GITHUB_ACTIONS_TOKEN (worker-dispatch permission); GITHUB_WORKER_OWNER=abangrenderofficial-oss; GITHUB_WORKER_REPO=mdab-129; GITHUB_WORKER_WORKFLOW=heavy-status-hq.yml; GITHUB_WORKER_REF=main
   - BAYARCASH_API_SECRET_KEY; BAYARCASH_API_TOKEN; BAYARCASH_PORTAL_KEY; BAYARCASH_SANDBOX=false (live mode)
   - WEBPUSH_VAPID_PUBLIC_KEY; WEBPUSH_VAPID_PRIVATE_KEY if PayPing browser push is needed.
4. Optional existing tuned encoding settings in .env.example can be copied without modification. Do not introduce extra CRF, scaling, bitrate, resolution or compression overrides during migration.
5. The container starts only when runtime/binary checks pass. Confirm GET https://YOUR-DOMAIN/api/health has `ok: true`.
6. **One-deploy cutover**: at the actual migration time, stop the old MediaX production instance so its jobs do not run twice. Set `MEDIAX_PREVIEW_MODE=false` and `MEDIAX_REGISTER_WEBHOOK_ON_START=true` **on the new host** before its first production start. The replacement server will check and activate the Telegram webhook pointing to PUBLIC_BASE_URL with `drop_pending_updates=false`, and skip registration on later restarts if already correct. No second deploy is needed. If you prefer manual activation, leave that variable false and run `node scripts/activate-webhook-no-drop.mjs` **once** in the new container after health passes. Do not use the old setup endpoint for cutover: it drops pending updates. Do not have two production replicas using the same Telegram bot token.
7. Test /start and private test downloads on a test bot first, then validate production with a fresh public link from each provider, Status HQ, gallery compression and Live Wallpaper. Check videos are not stretched, sound survives, and file sizes comply with Telegram limits.
8. If something fails, redirect Telegram webhook to the original domain and restore the old instance, using a no-drop update. Do not change or wipe Turso data. Disable `MEDIAX_REGISTER_WEBHOOK_ON_START` on the inactive server to avoid it reclaiming the webhook.

## Existing GitHub Actions worker — separate setup
Server ENV alone does NOT provide GitHub workflow secrets. In repo settings, the heavy-status-hq.yml workflow requires:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_API_ID
- TELEGRAM_API_HASH

These are GitHub Actions secrets (not Docker ENV). The Status HQ and Live Wallpaper heavy jobs run in GitHub Actions. For this repository's existing workflow, preserve the same bot token. Note the worker uses GITHUB_WORKER_REF=main: merge the prepared and tested package to main prior to final production cutover.

## Data, hosting and quality caveats
- Turso stores payment and affiliate state. Do not replace TURSO_DATABASE_URL with a fresh empty DB, or existing state may appear missing.
- If using STATS_FILE_PATH or another file-based counter, mount durable storage or use the existing remote/mirror stats backend. Containers are otherwise ephemeral.
- FFmpeg smoke/encoder checks show that the required runtime exists, not that every public Instagram/Threads/YouTube source will always resolve. External site restrictions, cookies, API limits, Telegram upload limits, memory or bandwidth can still affect some downloads.
- For repeatable builds, commit a tested package-lock.json when dependencies can be resolved; this repository currently does not contain one. Docker builds currently install from package.json version ranges and use the existing yt-dlp installer that downloads its current release.
- Disable automatic deploy on both old and new hosts; use manual promotion only after tests have passed. When merging this branch into main, an old Railway auto-deploy could otherwise be triggered.
- Docker smoke tests validate real local encoding and aspect ratio, but not all third-party download endpoints or Telegram delivery. Run a final test with actual links before announcing migration complete.
