import http from "node:http";
import { spawnSync } from "node:child_process";

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
const renderBaseUrlCorrect = String(process.env.PUBLIC_BASE_URL || "").replace(/\\/$/, "")
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


if (mode !== "active") {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    const good = req.method === "GET" || req.method === "HEAD";
    const allowed = ["/", "/healthz", "/api/health"].includes(pathname);
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
  server.listen(port, host, () => console.log("MediaX standby health endpoint listening at /healthz"));
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
