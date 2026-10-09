import http from "node:http";
import { spawnSync, spawn } from "node:child_process";

const mode = String(process.env.MEDIAX_MODE || "standby").toLowerCase();
const port = Number(process.env.PORT || 10000);
const host = "0.0.0.0";
const readinessRequired = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "SETUP_SECRET",
  "GITHUB_ACTIONS_TOKEN",
  "BAYARCASH_API_SECRET_KEY",
  "BAYARCASH_API_TOKEN",
  "BAYARCASH_PORTAL_KEY",
];
const readinessMissing = readinessRequired.filter((key) => !String(process.env[key] || "").trim());

// Railway user-defined feature keys only; exclude its generated RAILWAY_*,
// source build settings and local volume paths. Never print ENV values.
const railwayFeatureKeys = [
  "AFFILIATE_COMMISSION_PERCENT", "AFFILIATE_HOLD_DAYS", "AFFILIATE_MIN_WITHDRAW_RM",
  "BAYARCASH_API_SECRET_KEY", "BAYARCASH_API_TOKEN", "BAYARCASH_PAYER_EMAIL",
  "BAYARCASH_PORTAL_KEY", "BAYARCASH_SANDBOX", "BAYARCASH_SANDBOX_API_SECRET_KEY",
  "BAYARCASH_SANDBOX_API_TOKEN", "BAYARCASH_SANDBOX_PORTAL_KEY",
  "BOT_OWNER_ID", "CHANNEL_GATE_TRACE_USER_ID", "CONTENT_BRIDGE_SECRET",
  "CONTENT_MANAGER_URL", "DAILY_FORCE_REPAIR_USER_IDS", "DOWNLOADER_TIMEOUT_MS",
  "GITHUB_ACTIONS_TOKEN", "HEAVY_VIDEO_MAX_MB", "INSTAGRAM_MUX_SMOKE_URL",
  "INSTAGRAM_STORY_SMOKE_URL", "NTFY_PAYMENT_TOPIC", "PAYPING_SHARED_CONFIG_ENABLED",
  "SETUP_SECRET", "STATUS_HQ_SELFTEST_ENABLED", "STATUS_HQ_SELFTEST_URL",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TURSO_AUTH_TOKEN",
  "TURSO_DATABASE_URL", "UPDATE_DEDUPE_TTL_MS", "UPDATE_STALE_AFTER_MS",
  "WEBPUSH_VAPID_PRIVATE_KEY", "WEBPUSH_VAPID_PUBLIC_KEY", "WEBPUSH_VAPID_SUBJECT",
];
const featureMissingKeys = railwayFeatureKeys.filter((key) =>
  !Object.prototype.hasOwnProperty.call(process.env, key));
console.log("MEDIAX_BACKUP_FEATURE_ENV_PARITY", JSON.stringify({
  keyCount: railwayFeatureKeys.length,
  presentCount: railwayFeatureKeys.length - featureMissingKeys.length,
  missingNames: featureMissingKeys,
  note: "Presence check only; external authorization and runtime functionality not validated",
}));

const rawRenderBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim();
const renderBaseUrlCorrect = (rawRenderBaseUrl.endsWith("/")
  ? rawRenderBaseUrl.slice(0, -1) : rawRenderBaseUrl)
  === "https://mediax-railway-backup.onrender.com";
console.log("MEDIAX_BACKUP_READINESS_AUDIT", JSON.stringify({
  present: readinessRequired.length - readinessMissing.length,
  required: readinessRequired.length,
  missingNames: readinessMissing,
  renderBaseUrlCorrect,
  mode,
  failoverApprovalDisabled: process.env.MEDIAX_FAILOVER_APPROVED !== "YES_RAILWAY_STOPPED",
  statsFilePath: String(process.env.STATS_FILE_PATH || "/data/bot-stats.json").startsWith("/data/")
    ? "/data (not verified persistent on Render)"
    : "custom (not verified persistent)",
  persistentVolumeMigrationVerified: false,
  thirdPartyCallbacksVerified: false,
}));
// Read-only parity check. This prints ENV *names*, never secret values.
// Standby still cannot process Telegram/media/payment events.

// Snapshot probe is read-only and does not register Telegram webhooks or write to Turso.
let snapshotProbe = {checkedAt: 0, result: {ready: false, reason: "not_checked"}};
async function probeStatsSnapshot(force = false) {
  if (!force && Date.now() - snapshotProbe.checkedAt < 30_000) return snapshotProbe.result;
  let db;
  let result;
  try {
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      result = {ready: false, reason: "missing_database_configuration"};
    } else {
      const { createClient } = await import("@libsql/client");
      db = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
      const rows = await db.execute({
        sql: "SELECT payload_json, updated_at FROM mediax_statistics_snapshot WHERE namespace = ?",
        args: [process.env.MEDIAX_STATS_NAMESPACE || "mediax-production"],
      });
      if (!rows.rows.length) {
        result = {ready: false, reason: "snapshot_not_seeded"};
      } else {
        const snapshot = JSON.parse(String(rows.rows[0].payload_json));
        const valid = snapshot && typeof snapshot === "object"
          && snapshot.users && typeof snapshot.users === "object" && !Array.isArray(snapshot.users)
          && snapshot.monthlyDownloads && typeof snapshot.monthlyDownloads === "object"
          && !Array.isArray(snapshot.monthlyDownloads);
        result = valid
          ? {ready: true, reason: "snapshot_available", updatedAt: String(rows.rows[0].updated_at), userRecords: Object.keys(snapshot.users).length, monthBuckets: Object.keys(snapshot.monthlyDownloads).length}
          : {ready: false, reason: "invalid_snapshot"};
      }
    }
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    const reason = message.includes("no such table") ? "snapshot_table_missing"
      : (message.includes("unauthorized") || message.includes("401") || message.includes("403"))
        ? "database_auth_failed"
      : "database_query_failed";
    result = {ready: false, reason};
  } finally {
    try { db?.close(); } catch {}
  }
  snapshotProbe = {checkedAt: Date.now(), result};
  return result;
}



// Safe standby payment verification: query only Bayarcash portal metadata.
// Never create payment intents, register callbacks or send Telegram updates here.
async function probePaymentPortal() {
  try {
    const { isBayarcashConfigured, getBayarcashPortalDiagnostic } =
      await import("../src/payments/bayarcash.js");
    if (!isBayarcashConfigured()) return {ready: false, reason: "credentials_missing"};
    const portal = await getBayarcashPortalDiagnostic();
    return {
      ready: portal.paymentChannels.length > 0,
      reason: portal.paymentChannels.length ? "portal_accessible" : "no_payment_channels",
      sandbox: Boolean(portal.sandbox),
      channelCount: portal.paymentChannels.length,
    };
  } catch (error) {
    const code = String(error?.code || "").replace(/[^A-Z0-9_]/g, "").slice(0, 64);
    return {ready: false, reason: code || "portal_request_failed"};
  }
}

if (mode !== "active") {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    const good = req.method === "GET" || req.method === "HEAD";
    const allowed = ["/", "/healthz", "/api/health"].includes(pathname);
    if (good && pathname === "/readyz") {
      const stats = await probeStatsSnapshot();
      res.writeHead(stats.ready ? 200 : 503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      if (req.method === "HEAD") return res.end();
      return res.end(JSON.stringify({
        ok: stats.ready,
        service: "mediax-railway-backup",
        mode: "standby",
        statsReady: stats.ready,
        statsReason: stats.reason,
        telegramWebhookActive: false,
        readyForCutover: false
      }));
    }
    const healthy = good && allowed;
    res.writeHead(healthy ? 200 : 503, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    if (req.method !== "HEAD") {
      res.end(JSON.stringify({
        ok: healthy, service: "mediax-railway-backup", mode: "standby",
        telegramWebhookActive: false, readyForCutover: false
      }));
    } else res.end();
  });
  server.listen(port, host, () => {
    console.log("MediaX standby health endpoint listening at /healthz");
    void probeStatsSnapshot(true).then((stats) =>
      console.log("MEDIAX_RENDER_STATS_READINESS", JSON.stringify(stats)));
    void probePaymentPortal().then((payment) =>
      console.log("MEDIAX_RENDER_BAYARCASH_READINESS", JSON.stringify(payment)));
    if (process.env.MEDIAX_RENDER_MEDIA_SMOKE === "1") {
      // Run as a separate, killable process. The HTTP health endpoint is not blocked.
      const smoke = spawn(process.execPath, ["render/standby-media-smoke.mjs"], {
        stdio: "inherit", env: process.env,
      });
      const killer = setTimeout(() => {
        console.warn("MEDIAX_RENDER_MEDIA_AUDIT_TIMEOUT — 4 minute safety limit");
        smoke.kill("SIGTERM");
      }, 240_000);
      killer.unref();
      smoke.on("exit", (code, signal) => {
        clearTimeout(killer);
        console.log("MEDIAX_RENDER_MEDIA_AUDIT_PROCESS", JSON.stringify({code,signal}));
      });
      smoke.on("error", (error) => {
        clearTimeout(killer);
        console.error("MEDIAX_RENDER_MEDIA_AUDIT_PROCESS_ERROR", error.code || "spawn_failed");
      });
    }
  });
} else {
  if (process.env.MEDIAX_FAILOVER_APPROVED !== "YES_RAILWAY_STOPPED") {
    throw new Error("FAIL CLOSED: explicit failover approval required. Do not run Railway and Render Telegram updates simultaneously.");
  }

  const required = [
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET",
    "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN",
    "PUBLIC_BASE_URL", "SETUP_SECRET"
  ];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error("Missing critical ENV: " + missing.join(", "));

  const publicUrl = new URL(process.env.PUBLIC_BASE_URL);
  if (publicUrl.protocol !== "https:" ||
      publicUrl.hostname !== "mediax-railway-backup.onrender.com") {
    throw new Error("PUBLIC_BASE_URL must point to the new Render backup hostname");
  }

  // Never activate a Render instance with empty or ephemeral /data counters.
  if (process.env.MEDIAX_STATS_BACKEND !== "turso") {
    throw new Error("FAIL CLOSED: MEDIAX_STATS_BACKEND=turso is required for Render activation");
  }
  const statsReady = await probeStatsSnapshot(true);
  if (!statsReady.ready) {
    throw new Error("FAIL CLOSED: Turso statistics snapshot is not ready");
  }
  await import("../server.js");
  const deadline = Date.now() + 20_000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    try {
      const r = await fetch("http://127.0.0.1:" + port + "/api/health", {
        signal: AbortSignal.timeout(2_000)
      });
      ready = r.ok;
    } catch {}
    if (!ready) await new Promise(r => setTimeout(r, 800));
  }
  if (!ready) throw new Error("Local MediaX API health check failed, webhook unchanged");

  const registration = spawnSync(process.execPath,
    ["scripts/register-railway-webhook.mjs"], { stdio: "inherit", timeout: 35_000 });
  if (registration.status !== 0) throw new Error("Telegram webhook registration failed");
  console.log("MediaX Render ACTIVATED; confirm Railway is stopped and third-party payment callbacks point to Render");
}
