# MediaX Render disaster-recovery standby (not live)

This is an **isolated branch** for a future Render backup. It does not modify the Railway production branch.

## Current readiness

- Source: `abangrenderofficial-oss/mdab-129`, branch `infra/mediax-render-standby`.
- Render service: **not yet created** because the existing Render Hobby workspace returned `Hobby Tier is limited to 25 services`.
- Main Railway service must remain the sole live Telegram webhook owner.
- ENV and the Railway `/data` volume have **not** been copied.

## Safe Render Web Service settings (once a slot is available)

- Name: `mediax-railway-backup`
- Repository: `abangrenderofficial-oss/mdab-129`
- Branch: `infra/mediax-render-standby`
- Region: Singapore; Node runtime
- Build: `npm ci`
- Start: `node render/mediax-backup-entry.mjs`
- Initial environment:
  - `MEDIAX_MODE=standby`
  - `MEDIAX_FAILOVER_APPROVED=NO`
  - `PUBLIC_BASE_URL=https://mediax-railway-backup.onrender.com`
- Do not add a pre-deploy hook that registers a Telegram webhook.
- `GET /healthz` and `GET /api/health` return HTTP 200 while standby; the JSON explicitly reports `mode: standby`, `readyForCutover: false`.
- Never treat a standby health check as proof that MediaX can process user downloads.

## ENV transfer

Railway's connected OAuth integration returns ENV names only; 53 names were identified, but the values are inaccessible through that connection. A secure one-time bulk import in Render is sufficient for **persisting** those values; automatic sync is not required unless values change later.

Get the values from an authorized Railway export or console and paste them **directly** into the Render Environment bulk editor. Do **not** send the .env file through chat, logs, GitHub, or a public URL.

Important: preserve Render's `PUBLIC_BASE_URL`, `PORT`, `MEDIAX_MODE`, and `MEDIAX_FAILOVER_APPROVED`. The `STATS_FILE_PATH` and other Railway volume paths must be reconsidered on Render. Do not copy Railway-generated platform variables.

Critical for failover: Telegram token/webhook secret, Turso URL/token, setup secret, Bayarcash credentials, PayPing/shared config and all other bot-specific feature values. Compare **keys and nonsecret readiness flags only**; never echo secret values in logs. Sealed Railway secrets may require reentry from their original issuing service.

## Persistent data

Railway MediaX has a 256 MB volume `bot-stats` mounted at `/data`. Deploying identical source on Render does **not** clone this volume. Confirm which on-disk state is non-reconstructible; take a safe backup and restore or migrate it to a durable data store before promising full failover. Turso is external and may be reused with appropriate access.

## UptimeRobot

Create separate HTTP(s) monitors:
- Primary: `https://bottelett-reels-thread-yt-production.up.railway.app/api/health`
- Render standby (when created): `https://mediax-railway-backup.onrender.com/healthz`

Standby health is NOT a signal that the Telegram bot has failed over. Enable email/Telegram outage notifications. Render Free can spin down, delaying cold start.

## Controlled manual cutover (after testing)

1. Check Render ENV, build, URL, storage and external callback dependencies.
2. Stop or disconnect the Railway primary from Telegram updates. Ensure one webhook owner only.
3. Confirm Railway is actually stopped, and that any scheduled background workers won't duplicate side effects.
4. Set `MEDIAX_MODE=active` and `MEDIAX_FAILOVER_APPROVED=YES_RAILWAY_STOPPED` on Render, leaving `PUBLIC_BASE_URL` pointing to its Render hostname.
5. Deploy Render. The entry verifies required ENV and its own local HTTP health before running the existing Telegram webhook-registration script.
6. Confirm Telegram webhook, test one supported media link, Status HQ, user access control, PayPing webhook/callback handling, and data persistence. Update third-party callback URLs where necessary.
7. For failback, reverse the process safely; do NOT operate both active instances concurrently.

Do not claim 100% failover readiness before completing and testing ENV, storage, payment callbacks, and a cutover rehearsal.
