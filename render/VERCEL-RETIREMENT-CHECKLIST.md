# MediaX: Vercel -> Render removal gate

Last verified: 2026-10-10 (Malaysia time). Vercel must **not** be deleted automatically.

## Scope
Original Vercel project: `mdab-129` / `mdab-129.vercel.app`, project `prj_cCV1JeReHnWfAHfi5PIPU0WKMspc`.
Render replacement: `mediax-railway-backup.onrender.com` on `infra/mediax-render-standby`.
Railway remains the active Telegram bot and Bayarcash callback owner. Do **not** shut down Railway, move its webhook or delete its `/data` volume.

## Completed and verified

- [x] Matched the 57 rewrite URLs in the actual last Vercel production deployment (commit `827c9fb`) and current `vercel.json` to Render's 56 explicit routes plus root.
- [x] Restored four missing Render endpoints: `/api/heavy-limit`, `/api/payping-bot-admin`, `/ar-payment/bots/add`, `/ar-payment/bots/add/`.
- [x] Added `MEDIAX_MODE=web_only`, serving PayPing and affiliate web/API routes without starting Telegram schedulers or registering webhook. Bot, setup, Bayarcash and HQ callback routes are denied with 503 in web-only mode.
- [x] Isolated GitHub CI verified page/API routing; zero missed handlers.
- [x] Live GitHub-runner HTTP probe confirmed eight PayPing pages/assets (including bot wizard and service worker), `/api/heavy-limit`, unauthenticated login denial and admin-only protection, and rejection of all Telegram/gateway endpoints.
- [x] Render `/api/payment-push` reports configured VAPID.
- [x] MediaX Turso stats were previously verified: 835 users and two month buckets.
- [x] Railway Telegram bot remained online when Render web-only was enabled.

## Blocking before removing Vercel

- [ ] Verify actual PayPing **owner login** and accurate transactions, supporters, bot catalog, affiliates and commission balance on Render in the user's browser (do not ask user to share password).
- [ ] Verify creating/pausing a *test bot*, plan updates and RBAC with an authorized account; do not change live bot plans as a smoke test.
- [ ] Verify **end-to-end push notification** registration and delivery from the Render origin on the user's phone, including background PWA delivery, badge, notification details and manual follow-up. Vercel's public push endpoint returned HTTP **503** in an unauthenticated check, so VAPID key parity to old origin was **not verifiable**.
- [ ] Re-open/reinstall the Render PayPing PWA and re-register device push subscriptions: service workers, PWA installation, browser session cookies and notification permission are tied to the **web origin**. They do not automatically migrate just because Turso data is shared.
- [ ] Confirm `TURSO_DATABASE_URL`, support environment (production), password pepper/encryption fallback and PayPing bot credentials match the Vercel-provisioned values. ENV *presence* alone is not sufficient.
- [ ] Inventory any active Vercel host references in sent Telegram messages, bookmarks, webhook callbacks, PWA installs, redirects, QR links, affiliate links and external services; migrate to Render or a stable domain and wait for in-flight payments to settle.
- [ ] Determine whether Bayarcash or PayPing event callbacks **currently point to the Vercel domain**. Do not remove it until those callbacks are explicitly migrated and reconciled. While Railway is primary, its callbacks stay with Railway.
- [ ] Verify all transactions and alerts still reconcile after external-origin migration; check refunds/failed/cancelled orders and affiliate ledger before/after without duplicating transactions.
- [ ] Keep at least one rollback window with Vercel unchanged after users start using Render. Do not rename/delete or release the old project until recovery is proven.
- [ ] Full MediaX **bot** failover remains separate: YouTube reliability, Status HQ real send and payment callbacks are not yet 100% proven on Render. No Telegram cutover without deliberate approval.

## How to test without affecting the bot

Render production currently supports optional `MEDIAX_MODE=web_only`: PayPing and affiliate web traffic, but Telegram webhook stays on Railway. Open `https://mediax-railway-backup.onrender.com/ar-payment/` directly.
Tests `scripts/render-vercel-route-parity-selftest.mjs`, `scripts/render-web-only-selftest.mjs`, `scripts/render-live-web-parity-smoke.mjs` and `scripts/render-vercel-push-public-compare.mjs` exercise unauthenticated routes only. Review deploy logs for `MEDIAX_RENDER_WEB_ONLY_READY` and `MEDIAX_RENDER_PAYPING_DB_READINESS`.

Do not use Vercel's internal project delete action before all blocking checks above are signed off.
