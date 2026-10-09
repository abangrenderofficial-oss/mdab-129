# MediaX Railway -> Render standby failover runbook

Last audited: 2026-10-09. Railway is the active production bot and must NOT be deleted.

## Verified environment

| Component | Verified state |
| --- | --- |
| Railway main MediaX | Online after controlled opt-in mirror rollout; one instance |
| Render standby | Live at https://mediax-railway-backup.onrender.com |
| Git source | Same main application server/statistics implementation as Railway, with isolated Render standby entry |
| Telegram webhook | Still belongs exclusively to Railway |
| Render ENV | 35/35 user-defined feature ENV names present; 9/9 critical nonempty; values are never logged |
| Statistics | Railway mirror warmed 835 user records and 2 month buckets; Render read matching 835 / 2 from Turso |
| Render Turso read probe | ready=true, snapshot_available (read-only) |
| Bayarcash Render portal probe | ready=true, production portal accessible, one active payment channel (read-only) |
| Real MediaX Render Telegram end-to-end | NOT yet tested — do not claim full functionality |
| Existing Bayarcash in-flight callbacks and PayPing delivery on Render | NOT yet tested — do not claim full payment failover |
| Render free tier | Can spin down after inactivity; no persistent disk and not guaranteed always-on |

## Runtime configuration

Railway retains the original persistent volume `bot-stats`, mounted at `/data`.
The production bot has:
- `MEDIAX_STATS_BACKEND=mirror`
- `MEDIAX_STATS_NAMESPACE=mediax-production`
- Its existing `STATS_FILE_PATH` and all original secrets/other ENV unchanged

Mirror mode reads/writes Railway's original `/data/bot-stats.json` as the authority, writes a one-time immutable seed backup in Turso table `mediax_statistics_seed_backup`, and updates `mediax_statistics_snapshot` on each stats mutation. Mirror outages should not stop local Railway writes. On startup, the main bot attempts to warm the mirror through its cached stats loader.

Render standby configuration:
- `MEDIAX_MODE=standby`
- `MEDIAX_FAILOVER_APPROVED=NO`
- `MEDIAX_STATS_BACKEND=turso`
- `MEDIAX_STATS_NAMESPACE=mediax-production`
- `PUBLIC_BASE_URL=https://mediax-railway-backup.onrender.com`
- critical Railway feature secrets copied directly into Render Environment; never paste them into GitHub or chat
- start command `node render/mediax-backup-entry.mjs` and build command `npm ci`

Render standby exposes:
- `GET /healthz`: 200 only proves passive server is awake.
- `GET /readyz`: 200 only when a valid Turso stats snapshot is readable. It does not prove all media/payment integrations work.
- `GET /api/health`: health of the passive server, not an active Telegram processor.

In standby, Telegram/webhook/download/payment endpoints are unavailable and no bot schedulers start. A Bayarcash **read-only** portal diagnostic runs at startup, without creating transactions.

## Keep both services while Railway trial lasts

- DO NOT remove Railway or detach its `/data` volume.
- DO NOT enable Render while Railway is accepting Telegram updates.
- DO NOT run two independent active Telegram service instances, because timers, outgoing messages, callback processing and state updates could duplicate.
- Periodically inspect Railway logs for `mirror sync unavailable` and Render logs for `MEDIAX_RENDER_STATS_READINESS` and `MEDIAX_RENDER_BAYARCASH_READINESS`.
- Render Free can cold start after 15 minutes of idle time; it is not an always-on guarantee.

## Preconditions for full replacement

1. Confirm the latest Railway and Render stats snapshot user counts and monthly counts are equal; do not cut over with stale/missing data.
2. Confirm a current real media link from TikTok, Instagram, Threads, YouTube, and gallery -> Status HQ can be processed on Render (during a scheduled controlled trial).
3. Verify Render's external dependencies at real runtime: yt-dlp, ffmpeg/Chromium, remote workers, GitHub Actions heavy-worker access, Telegram upload size/timeouts, PayPing shared config.
4. Review and test Bayarcash callback and return URLs (generated from `PUBLIC_BASE_URL` for new intents). In-flight Railway checkout intents may still callback to the Railway URL. Verify payment reconciliation, notifications and affiliate posting.
5. Confirm actual Telegram group video monitoring, channel-gating counts, forced support rules, and administrative commands.
6. Verify Render compute and cold-start behavior against expected production traffic.
7. Confirm there is a rollback plan: Railway code and persistent data remain intact.

## Controlled cutover — NOT executed yet

Only when the primary must be retired:
1. Schedule a quiet change window, reconcile the last Railway stats mirror, finish/monitor in-flight payment transactions.
2. Stop Railway runtime **without deleting the Railway project, volumes or secrets**. Verify it is not processing updates.
3. In Render Environment confirm the Turso snapshot is valid and set:
   - `MEDIAX_MODE=active`
   - `MEDIAX_FAILOVER_APPROVED=YES_RAILWAY_STOPPED`
   - retain `MEDIAX_STATS_BACKEND=turso` and the Render `PUBLIC_BASE_URL`
4. Deploy Render. The entry refuses activation without approval, required secrets, Render hostname and a readable Turso snapshot. It checks its local HTTP app before changing Telegram's webhook.
5. Confirm Telegram `getWebhookInfo` points to `https://mediax-railway-backup.onrender.com/api/telegram` (with existing mirror_group retained).
6. Run real functional regression tests for media, Status HQ, support/payment, PayPing, affiliates and monitoring, and reconfigure any third-party integrations still pointing to the Railway hostname.

## Rollback

- If Railway mirror writes cause unexpected delays or errors, set Railway `MEDIAX_STATS_BACKEND=file`; its original `/data/bot-stats.json` remains the authority and unchanged in format. Do not delete the Turso backup.
- If the Render cutover fails, first stop Render's active bot, then restore Railway primary and re-register its original webhook. Avoid simultaneous active primary instances.
- If Render processed new user stats after cutover, reconcile them back into Railway storage before resuming Railway; simply reverting the webhook without reconciling risks counter rollback.

## Open blockers before claiming 100% replacement

- End-to-end media / Status HQ on Render infrastructure not proven.
- Real Bayarcash callback -> PayPing -> Telegram notifications and affiliate accounting after cutover not proven.
- Pending payments created with Railway callback URLs must be handled.
- Render Free is not guaranteed equivalent to Railway in uptime, compute, or persistent local filesystem.


## 2026-10-09 Render Status HQ CPU offload (branch-only)

The full local TikTok HQ smoke on Render Free failed its 8-minute safety deadline. It resolved the media, but direct CDN download returned HTTP 403 and local fallback/encoding never completed. The one-second synthetic FFmpeg encode passed. **Do not assume the local HQ path will be production-ready on Render Free.**

Render-only code now offloads **all Telegram video file_id Premium+ HQ and Android HQ buttons** when `MEDIAX_MODE=active` to the existing GitHub Actions heavy worker. Telegram's `video.file_id` is reused so the expensive media download/HEVC or H.264 encode does not run inside Render's 512 MB web service. For the direct `/status <social-link>` command (no Telegram video file_id), the Render branch supports a validated HTTPS social URL source, processed by the GitHub runner; no raw file is processed by Render itself. Railway's default behavior is unchanged.

The Render action dispatcher chooses GitHub ref `infra/mediax-render-standby` for active Render, otherwise `main`, and the worker's signed completion callback points to Render `/api/premium-hq-success`. Usage is counted only after successful delivery; duplicate callback keys remain supported. The worker validates HEVC/AAC codec, source audio preservation, pixel format, and a 47 MB safety output bound before sending HQ. URL inputs are restricted to approved social HTTPS hostnames to block internal/SSRF destinations.

Offline GitHub Actions workflow `render-hq-worker-readiness.yml` passed:
- Render versus Railway selection and GitHub dispatch arguments, using mocked fetch only
- Unsafe URL rejection, source URL worker routing and cleanly downloaded file path (mocked)
- Synthetic two-second HEVC HQ transcode with AAC preserved
- Synthetic video without audio stays silent, with codec/output limits validated

**This is NOT a live Telegram or complete user-quality test.** No GitHub workflow was dispatched against real Telegram video file_ids during standby. GitHub worker secrets (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_BOT_TOKEN`) and action permission, MTProto retrieval, queue latency, callback signature, video upload and fidelity are still unproven for the Render branch. The original source-first local path may preserve more quality than a Telegram video file_id copy; compare actual output visually before declaring parity. For `/status <link>`, yt-dlp may itself be blocked by social platforms on GitHub runners; real source URL tests are required.

Do not set `MEDIAX_MODE=active` or `MEDIAX_FAILOVER_APPROVED=YES_RAILWAY_STOPPED` just to test HQ. A real smoke requires a controlled cutover window or a separate authorized test bot, otherwise two active runtimes can duplicate messages. Existing standby `MEDIAX_RENDER_STATUS_HQ_SMOKE=0` remains disabled.



### Additional live external-network finding

The GitHub runner's optional public TikTok URL smoke on 2026-10-09 **FAILED**: TikWM metadata requests returned HTTP errors and yt-dlp exited non-zero (using the `vt.tiktok.com/ZSqqYxc13/` sample). This is separate from the successful **offline** synthetic HEVC/AAC/audio tests and routing assertions. The URL-only `/status <link>` worker is implemented but **not production-ready** until a real URL can consistently download from a GitHub worker. Do not rely on the workflow's green conclusion for URL tests: the one-off public-network step was intentionally `continue-on-error`. To avoid consuming GitHub Actions minutes, this optional network step runs only via manual `workflow_dispatch`.

For active Render failover, Premium HQ and Android HQ buttons should use existing Telegram `file_id` transfer to the heavy worker rather than social CDN URL re-download from Render Free. Real MTProto media fetch, sendVideo, signed callback and real output fidelity remain unverified while Render is standby. Never represent this as 100% parity with Railway until a controlled end-to-end test passes.
