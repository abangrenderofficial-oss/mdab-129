# Dual Runtime Copy Plan

This repository is intentionally provider-neutral.

## Runtime layout

- Source of truth: GitHub `abangrenderofficial-oss/mdab-129`
- Primary candidate runtime: Vercel
- Fallback runtime: Railway / any long-running Node host
- Heavy media worker: GitHub Actions
- Shared database: Turso / libSQL
- Payment provider: Bayarcash
- Telegram: webhook client of whichever light runtime is currently active

## Rule: copy, do not migrate destructively

Do not remove Railway compatibility when enabling Vercel.
Do not point production Telegram or Bayarcash callbacks at Vercel until the copy passes all checks.

The same business handlers are shared:
- Vercel: `api/router.js -> handlers/*`
- Railway/Node: `server.js -> handlers/*`

## Vercel variables to copy

Critical:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_WEBHOOK_SECRET
- TURSO_DATABASE_URL
- TURSO_AUTH_TOKEN
- GITHUB_ACTIONS_TOKEN
- BAYARCASH_API_SECRET_KEY
- BAYARCASH_API_TOKEN
- BAYARCASH_PORTAL_KEY

Recommended/shared:
- BOT_OWNER_ID
- SETUP_SECRET
- BAYARCASH_PAYER_EMAIL
- BAYARCASH_SANDBOX
- BAYARCASH_SANDBOX_API_SECRET_KEY
- BAYARCASH_SANDBOX_API_TOKEN
- BAYARCASH_SANDBOX_PORTAL_KEY
- AFFILIATE_COMMISSION_PERCENT
- AFFILIATE_HOLD_DAYS
- AFFILIATE_MIN_WITHDRAW_RM
- CONTENT_MANAGER_URL
- CONTENT_BRIDGE_SECRET
- DOWNLOADER_TIMEOUT_MS
- UPDATE_STALE_AFTER_MS
- UPDATE_DEDUPE_TTL_MS
- WEBPUSH_VAPID_PUBLIC_KEY
- WEBPUSH_VAPID_PRIVATE_KEY
- WEBPUSH_VAPID_SUBJECT
- NTFY_PAYMENT_TOPIC

Worker defaults, when not using code defaults:
- HEAVY_VIDEO_THRESHOLD_MB
- HEAVY_VIDEO_MAX_MB
- GITHUB_WORKER_OWNER
- GITHUB_WORKER_REPO
- GITHUB_WORKER_WORKFLOW
- GITHUB_WORKER_REF
- GITHUB_WORKER_DISPATCH_TIMEOUT_MS

## Never blindly copy these Railway-generated variables

- RAILWAY_*
- RAILPACK_*
- RAILWAY_VOLUME_*
- RAILWAY_PUBLIC_DOMAIN
- RAILWAY_PRIVATE_DOMAIN
- RAILWAY_STATIC_URL

## PUBLIC_BASE_URL rule

Do not copy the Railway PUBLIC_BASE_URL value into Vercel unchanged.

Preview:
- Prefer leaving PUBLIC_BASE_URL unset so request host is derived automatically.

Production Vercel:
- Set PUBLIC_BASE_URL to the final Vercel/custom production origin only after that origin is known.

Fallback Railway:
- Restore PUBLIC_BASE_URL to the Railway production origin if explicitly configured.

This matters because GitHub Actions completion callbacks and payment/support redirects can use the runtime base URL.

## Copy validation gates

Before Telegram/Bayarcash cutover, all of these must pass:

1. Vercel deployment = READY / SUCCESS
2. GitHub Code Syntax Check = SUCCESS
3. Node/Railway fallback runtime smoke = SUCCESS
4. Vercel copy smoke = reachable
5. `/api/health` reports no critical missing runtime variables
6. Turso read/write test succeeds from Vercel
7. Telegram webhook handler can process a controlled test update
8. GitHub Actions heavy dispatch succeeds from Vercel
9. Heavy worker completion callback reaches Vercel
10. Bayarcash test/sandbox callback reaches Vercel and writes to Turso
11. Affiliate commission self-test remains green
12. PayPing PWA routes load correctly

## Production cutover

Only after all gates pass:

1. Keep Railway deployment running.
2. Point Telegram webhook to Vercel.
3. Confirm normal command/download behavior.
4. Confirm heavy media dispatch goes Vercel -> GitHub Actions -> Telegram.
5. Point Bayarcash callback/return URL to Vercel.
6. Confirm payment -> Turso -> notification -> affiliate flow.
7. Leave Railway available as fallback while trial remains active.

## Rollback / fallback

No code migration back is required.

If Vercel has a production incident:

1. Point Telegram webhook back to Railway.
2. Point Bayarcash callback/return URL back to Railway if payment traffic is affected.
3. Set PUBLIC_BASE_URL back to Railway origin if required.
4. Verify `/api/health`.
5. Keep Turso and GitHub Actions unchanged.

Because both runtimes use the same handlers and Turso database, no data copy is required for rollback.

## Current migration branch

- Branch: `migration/vercel-runtime`
- PR: #29
- Railway production is still on `main` and must remain untouched until cutover gates pass.
