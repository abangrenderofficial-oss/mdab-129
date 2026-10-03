const CRITICAL_RUNTIME_ENV = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'GITHUB_ACTIONS_TOKEN',
  'BAYARCASH_API_SECRET_KEY',
  'BAYARCASH_API_TOKEN',
  'BAYARCASH_PORTAL_KEY',
];

export default function handler(req, res) {
  const missing = CRITICAL_RUNTIME_ENV.filter((name) => !String(process.env[name] || '').trim());
  res.status(200).json({
    ok: missing.length === 0,
    service: 'telegram-social-downloader',
    runtime: process.env.VERCEL ? 'vercel' : (process.env.RAILWAY_ENVIRONMENT ? 'railway' : 'node'),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    tursoConfigured: Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN),
    githubWorkerConfigured: Boolean(process.env.GITHUB_ACTIONS_TOKEN),
    bayarcashConfigured: Boolean(
      process.env.BAYARCASH_API_SECRET_KEY
      && process.env.BAYARCASH_API_TOKEN
      && process.env.BAYARCASH_PORTAL_KEY
    ),
    missingRuntimeEnv: missing,
    heavyMediaRuntime: 'github-actions',
    databaseRuntime: 'turso',
    paidApiRequired: false,
  });
}
