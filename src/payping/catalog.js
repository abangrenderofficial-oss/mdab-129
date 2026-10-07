import { currentSupportEnvironment, getSupportDb } from '../support/store.js';

let schemaPromise = null;
let seedPromise = null;

function clean(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function boolInt(value) {
  return value ? 1 : 0;
}

function rowToBot(row) {
  if (!row) return null;
  return {
    id: String(row.bot_id || ''),
    slug: String(row.slug || ''),
    name: String(row.name || ''),
    telegramBotId: String(row.telegram_bot_id || ''),
    telegramUsername: String(row.telegram_username || ''),
    status: String(row.status || 'active'),
    affiliateEnabled: Number(row.affiliate_enabled || 0) === 1,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function rowToPlan(row) {
  if (!row) return null;
  return {
    id: String(row.plan_id || ''),
    botId: String(row.bot_id || ''),
    name: String(row.name || ''),
    amount: (Number(row.amount_cents || 0) / 100).toFixed(2),
    amountCents: Number(row.amount_cents || 0),
    durationDays: Number(row.duration_days || 0),
    status: String(row.status || 'active'),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function rowToPortal(row) {
  if (!row) return null;
  return {
    id: String(row.portal_id || ''),
    botId: String(row.bot_id || ''),
    provider: String(row.provider || ''),
    label: String(row.label || ''),
    portalKeyEnv: String(row.portal_key_env || ''),
    apiTokenEnv: String(row.api_token_env || ''),
    apiSecretEnv: String(row.api_secret_env || ''),
    status: String(row.status || 'unconfigured'),
    configured: Boolean(
      row.portal_key_env
      && String(process.env[String(row.portal_key_env)] || '').trim()
    ),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

export async function ensurePayPingCatalogSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS payping_bots (
          environment TEXT NOT NULL,
          bot_id TEXT NOT NULL,
          slug TEXT NOT NULL,
          name TEXT NOT NULL,
          telegram_bot_id TEXT NOT NULL DEFAULT '',
          telegram_username TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          affiliate_enabled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, bot_id),
          UNIQUE (environment, slug)
        )`,
        `CREATE TABLE IF NOT EXISTS payping_plans (
          environment TEXT NOT NULL,
          plan_id TEXT NOT NULL,
          bot_id TEXT NOT NULL,
          name TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          duration_days INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, plan_id)
        )`,
        `CREATE TABLE IF NOT EXISTS payping_payment_portals (
          environment TEXT NOT NULL,
          portal_id TEXT NOT NULL,
          bot_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          label TEXT NOT NULL,
          portal_key_env TEXT NOT NULL DEFAULT '',
          api_token_env TEXT NOT NULL DEFAULT '',
          api_secret_env TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'unconfigured',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, portal_id)
        )`,
        `CREATE TABLE IF NOT EXISTS payping_order_context (
          environment TEXT NOT NULL,
          order_number TEXT NOT NULL,
          bot_id TEXT NOT NULL,
          plan_id TEXT,
          portal_id TEXT,
          referral_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, order_number)
        )`,
        `CREATE TABLE IF NOT EXISTS payping_subscriptions (
          environment TEXT NOT NULL,
          subscription_id TEXT NOT NULL,
          bot_id TEXT NOT NULL,
          plan_id TEXT NOT NULL,
          telegram_user_id TEXT NOT NULL,
          order_number TEXT NOT NULL,
          status TEXT NOT NULL,
          starts_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, subscription_id),
          UNIQUE (environment, order_number)
        )`,
        `CREATE TABLE IF NOT EXISTS payping_bot_affiliates (
          environment TEXT NOT NULL,
          bot_id TEXT NOT NULL,
          affiliate_user_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          commission_type TEXT NOT NULL DEFAULT 'percent',
          commission_value INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, bot_id, affiliate_user_id)
        )`,
        `CREATE TABLE IF NOT EXISTS payping_referrals (
          environment TEXT NOT NULL,
          referral_id TEXT NOT NULL,
          bot_id TEXT NOT NULL,
          affiliate_user_id TEXT NOT NULL,
          referred_user_id TEXT,
          referral_code TEXT NOT NULL,
          order_number TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY (environment, referral_id)
        )`,
        `CREATE TABLE IF NOT EXISTS payping_affiliate_commissions (
          environment TEXT NOT NULL,
          commission_id TEXT NOT NULL,
          bot_id TEXT NOT NULL,
          affiliate_user_id TEXT NOT NULL,
          referred_user_id TEXT NOT NULL,
          order_number TEXT NOT NULL,
          gross_cents INTEGER NOT NULL,
          commission_cents INTEGER NOT NULL,
          status TEXT NOT NULL,
          available_at TEXT,
          payout_request_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, commission_id),
          UNIQUE (environment, order_number)
        )`,
        'CREATE INDEX IF NOT EXISTS idx_payping_plans_bot ON payping_plans(environment, bot_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_payping_portals_bot ON payping_payment_portals(environment, bot_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_payping_subscriptions_user ON payping_subscriptions(environment, telegram_user_id, bot_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_payping_subscriptions_expiry ON payping_subscriptions(environment, bot_id, status, expires_at)',
        'CREATE INDEX IF NOT EXISTS idx_payping_bot_affiliates_bot ON payping_bot_affiliates(environment, bot_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_payping_referrals_bot ON payping_referrals(environment, bot_id, affiliate_user_id)',
        'CREATE INDEX IF NOT EXISTS idx_payping_commissions_bot ON payping_affiliate_commissions(environment, bot_id, affiliate_user_id, status)',
      ], 'write');
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function upsertBot(db, {
  id,
  slug,
  name,
  telegramBotId = '',
  telegramUsername = '',
  status = 'active',
  affiliateEnabled = false,
}) {
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO payping_bots (
      environment, bot_id, slug, name, telegram_bot_id, telegram_username,
      status, affiliate_enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(environment, bot_id) DO UPDATE SET
      slug = excluded.slug,
      name = excluded.name,
      telegram_bot_id = CASE
        WHEN excluded.telegram_bot_id <> '' THEN excluded.telegram_bot_id
        ELSE payping_bots.telegram_bot_id
      END,
      telegram_username = CASE
        WHEN excluded.telegram_username <> '' THEN excluded.telegram_username
        ELSE payping_bots.telegram_username
      END,
      status = excluded.status,
      affiliate_enabled = excluded.affiliate_enabled,
      updated_at = excluded.updated_at`,
    args: [
      environment,
      clean(id, 64),
      clean(slug, 64).toLowerCase(),
      clean(name, 120),
      clean(telegramBotId, 64),
      clean(telegramUsername, 80).replace(/^@+/, ''),
      clean(status, 32).toLowerCase() || 'active',
      boolInt(affiliateEnabled),
      now,
      now,
    ],
  });
}

async function upsertPlan(db, {
  id,
  botId,
  name,
  amountCents,
  durationDays,
  status = 'active',
}) {
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO payping_plans (
      environment, plan_id, bot_id, name, amount_cents, duration_days,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(environment, plan_id) DO UPDATE SET
      bot_id = excluded.bot_id,
      name = excluded.name,
      amount_cents = excluded.amount_cents,
      duration_days = excluded.duration_days,
      status = excluded.status,
      updated_at = excluded.updated_at`,
    args: [
      environment,
      clean(id, 64),
      clean(botId, 64),
      clean(name, 120),
      Math.max(0, Number(amountCents || 0)),
      Math.max(1, Number(durationDays || 1)),
      clean(status, 32).toLowerCase() || 'active',
      now,
      now,
    ],
  });
}

async function upsertPortal(db, {
  id,
  botId,
  provider = 'bayarcash',
  label,
  portalKeyEnv,
  apiTokenEnv,
  apiSecretEnv,
}) {
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  const portalEnv = clean(portalKeyEnv, 120);
  const status = portalEnv && String(process.env[portalEnv] || '').trim()
    ? 'active'
    : 'unconfigured';

  await db.execute({
    sql: `INSERT INTO payping_payment_portals (
      environment, portal_id, bot_id, provider, label, portal_key_env,
      api_token_env, api_secret_env, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(environment, portal_id) DO UPDATE SET
      bot_id = excluded.bot_id,
      provider = excluded.provider,
      label = excluded.label,
      portal_key_env = excluded.portal_key_env,
      api_token_env = excluded.api_token_env,
      api_secret_env = excluded.api_secret_env,
      status = excluded.status,
      updated_at = excluded.updated_at`,
    args: [
      environment,
      clean(id, 64),
      clean(botId, 64),
      clean(provider, 40).toLowerCase(),
      clean(label, 120),
      portalEnv,
      clean(apiTokenEnv, 120),
      clean(apiSecretEnv, 120),
      status,
      now,
      now,
    ],
  });
}

export async function seedDefaultPayPingCatalog() {
  if (!seedPromise) {
    seedPromise = (async () => {
      await ensurePayPingCatalogSchema();
      const db = await getSupportDb();

      await upsertBot(db, {
        id: 'mediax',
        slug: 'mediax',
        name: 'MediaX Downloader',
        status: 'active',
        affiliateEnabled: true,
      });
      await upsertPortal(db, {
        id: 'mediax-bayarcash',
        botId: 'mediax',
        label: 'MediaX Bayarcash',
        portalKeyEnv: 'BAYARCASH_PORTAL_KEY',
        apiTokenEnv: 'BAYARCASH_API_TOKEN',
        apiSecretEnv: 'BAYARCASH_API_SECRET_KEY',
      });

      await upsertBot(db, {
        id: 'musix',
        slug: 'musix',
        name: 'MusiX Downloader',
        telegramUsername: 'abangrender_musicdownloaderbot',
        status: 'active',
        affiliateEnabled: false,
      });
      await upsertPlan(db, {
        id: 'musix-annual-30',
        botId: 'musix',
        name: 'Annual Supporter',
        amountCents: 3000,
        durationDays: 365,
        status: 'active',
      });
      await upsertPortal(db, {
        id: 'musix-bayarcash',
        botId: 'musix',
        label: 'MusiX Bayarcash',
        portalKeyEnv: 'BAYARCASH_MUSIC_PORTAL_KEY',
        apiTokenEnv: 'BAYARCASH_MUSIC_API_TOKEN',
        apiSecretEnv: 'BAYARCASH_MUSIC_SECRET_KEY',
      });

      return true;
    })().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

export async function listPayPingBots() {
  await seedDefaultPayPingCatalog();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT environment, bot_id, slug, name, telegram_bot_id,
                 telegram_username, status, affiliate_enabled, created_at, updated_at
          FROM payping_bots
          WHERE environment = ?
          ORDER BY CASE bot_id WHEN 'mediax' THEN 0 WHEN 'musix' THEN 1 ELSE 2 END,
                   created_at ASC`,
    args: [environment],
  });

  const bots = [];
  for (const row of result.rows || []) {
    const bot = rowToBot(row);
    const [plansResult, portalsResult, supporterResult, affiliateResult] = await Promise.all([
      db.execute({
        sql: `SELECT environment, plan_id, bot_id, name, amount_cents,
                     duration_days, status, created_at, updated_at
              FROM payping_plans
              WHERE environment = ? AND bot_id = ?
              ORDER BY created_at ASC`,
        args: [environment, bot.id],
      }),
      db.execute({
        sql: `SELECT environment, portal_id, bot_id, provider, label,
                     portal_key_env, api_token_env, api_secret_env, status,
                     created_at, updated_at
              FROM payping_payment_portals
              WHERE environment = ? AND bot_id = ?
              ORDER BY created_at ASC`,
        args: [environment, bot.id],
      }),
      db.execute({
        sql: `SELECT COUNT(DISTINCT telegram_user_id) AS total
              FROM payping_subscriptions
              WHERE environment = ? AND bot_id = ? AND status = 'active'`,
        args: [environment, bot.id],
      }),
      db.execute({
        sql: `SELECT COUNT(*) AS total
              FROM payping_bot_affiliates
              WHERE environment = ? AND bot_id = ? AND status = 'active'`,
        args: [environment, bot.id],
      }),
    ]);

    bots.push({
      ...bot,
      plans: (plansResult.rows || []).map(rowToPlan),
      portals: (portalsResult.rows || []).map(rowToPortal),
      activeSupporters: Number(supporterResult.rows?.[0]?.total || 0),
      activeAffiliates: Number(affiliateResult.rows?.[0]?.total || 0),
    });
  }
  return bots;
}

export async function getPayPingBot(botId) {
  const id = clean(botId, 64);
  if (!id) return null;
  const bots = await listPayPingBots();
  return bots.find((bot) => bot.id === id || bot.slug === id) || null;
}
