import { createHash, randomBytes, randomInt } from 'node:crypto';
import webpush from 'web-push';

import { currentSupportEnvironment, getSupportDb } from './store.js';
import { telegram } from '../telegram.js';

const MALAYSIA_TIMEZONE = 'Asia/Kuala_Lumpur';
const SETUP_CODE_TTL_MS = 10 * 60 * 1000;
let schemaPromise = null;
let vapidConfigured = false;

function cleanText(value, maxLength = 200) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function sha256(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function setupCodeHash(code) {
  return sha256(`${currentSupportEnvironment()}:setup:${String(code || '').trim()}`);
}

function deviceTokenHash(token) {
  return sha256(`${currentSupportEnvironment()}:device:${String(token || '').trim()}`);
}

function endpointHash(endpoint) {
  return sha256(`${currentSupportEnvironment()}:endpoint:${String(endpoint || '').trim()}`);
}

export function webPushPublicKey() {
  return String(process.env.WEBPUSH_VAPID_PUBLIC_KEY || '').trim();
}

export function isWebPushConfigured() {
  return Boolean(
    webPushPublicKey()
    && String(process.env.WEBPUSH_VAPID_PRIVATE_KEY || '').trim()
    && String(process.env.WEBPUSH_VAPID_SUBJECT || '').trim()
  );
}

function configureVapid() {
  if (vapidConfigured) return true;
  if (!isWebPushConfigured()) return false;
  webpush.setVapidDetails(
    String(process.env.WEBPUSH_VAPID_SUBJECT).trim(),
    webPushPublicKey(),
    String(process.env.WEBPUSH_VAPID_PRIVATE_KEY).trim(),
  );
  vapidConfigured = true;
  return true;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS support_push_setup_codes (
          environment TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          used_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          PRIMARY KEY (environment, code_hash)
        )`,
        `CREATE TABLE IF NOT EXISTS support_push_subscriptions (
          environment TEXT NOT NULL,
          endpoint_hash TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          device_token_hash TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          disabled_at TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (environment, endpoint_hash)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_support_push_device_token
          ON support_push_subscriptions(environment, device_token_hash)`,
        `CREATE TABLE IF NOT EXISTS support_webpush_delivery (
          environment TEXT NOT NULL,
          delivery_key TEXT NOT NULL,
          endpoint_hash TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          last_error TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, delivery_key, endpoint_hash)
        )`,
      ], 'write');
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function validSubscription(input = {}) {
  const endpoint = cleanText(input?.endpoint, 2048);
  const p256dh = cleanText(input?.keys?.p256dh, 512);
  const auth = cleanText(input?.keys?.auth, 512);
  if (!endpoint.startsWith('https://') || !p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export async function createPushSetupCode(ownerUserId) {
  if (!isWebPushConfigured()) {
    const error = new Error('Web Push belum configured.');
    error.code = 'WEBPUSH_NOT_CONFIGURED';
    throw error;
  }

  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const userId = String(ownerUserId || '').trim();
  const code = String(randomInt(10000000, 100000000));
  const hash = setupCodeHash(code);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SETUP_CODE_TTL_MS);

  await db.batch([
    {
      sql: `DELETE FROM support_push_setup_codes
            WHERE environment = ? AND owner_user_id = ? AND used_at = ''`,
      args: [environment, userId],
    },
    {
      sql: `INSERT INTO support_push_setup_codes (
              environment, code_hash, owner_user_id, expires_at, used_at, created_at
            ) VALUES (?, ?, ?, ?, '', ?)`,
      args: [environment, hash, userId, expiresAt.toISOString(), now.toISOString()],
    },
  ], 'write');

  return { code, expiresAt: expiresAt.toISOString() };
}

export async function registerPushSubscription(code, subscription) {
  if (!configureVapid()) {
    const error = new Error('Web Push belum configured.');
    error.code = 'WEBPUSH_NOT_CONFIGURED';
    throw error;
  }

  const normalized = validSubscription(subscription);
  if (!normalized) {
    const error = new Error('Push subscription tidak sah.');
    error.code = 'INVALID_PUSH_SUBSCRIPTION';
    throw error;
  }

  const normalizedCode = String(code || '').trim();
  if (!/^\d{8}$/.test(normalizedCode)) {
    const error = new Error('Setup code tidak sah.');
    error.code = 'INVALID_SETUP_CODE';
    throw error;
  }

  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  const hash = setupCodeHash(normalizedCode);

  const codeResult = await db.execute({
    sql: `SELECT owner_user_id, expires_at, used_at
          FROM support_push_setup_codes
          WHERE environment = ? AND code_hash = ?
          LIMIT 1`,
    args: [environment, hash],
  });
  const row = codeResult.rows?.[0];
  if (!row || row.used_at || !row.expires_at || new Date(String(row.expires_at)).getTime() <= Date.now()) {
    const error = new Error('Setup code expired atau tidak sah. Generate /pushsetup baru.');
    error.code = 'SETUP_CODE_EXPIRED';
    throw error;
  }

  const consume = await db.execute({
    sql: `UPDATE support_push_setup_codes
          SET used_at = ?
          WHERE environment = ? AND code_hash = ? AND used_at = '' AND expires_at > ?`,
    args: [now, environment, hash, now],
  });
  if (Number(consume.rowsAffected || 0) !== 1) {
    const error = new Error('Setup code sudah digunakan. Generate /pushsetup baru.');
    error.code = 'SETUP_CODE_ALREADY_USED';
    throw error;
  }

  const token = randomBytes(32).toString('base64url');
  const eHash = endpointHash(normalized.endpoint);
  await db.execute({
    sql: `INSERT INTO support_push_subscriptions (
            environment, endpoint_hash, endpoint, p256dh, auth,
            device_token_hash, owner_user_id, created_at, updated_at, disabled_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')
          ON CONFLICT(environment, endpoint_hash) DO UPDATE SET
            endpoint = excluded.endpoint,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            device_token_hash = excluded.device_token_hash,
            owner_user_id = excluded.owner_user_id,
            updated_at = excluded.updated_at,
            disabled_at = ''`,
    args: [
      environment,
      eHash,
      normalized.endpoint,
      normalized.keys.p256dh,
      normalized.keys.auth,
      deviceTokenHash(token),
      String(row.owner_user_id || ''),
      now,
      now,
    ],
  });

  return { deviceToken: token };
}

async function activeSubscriptions() {
  await ensureSchema();
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT endpoint_hash, endpoint, p256dh, auth
          FROM support_push_subscriptions
          WHERE environment = ? AND disabled_at = ''
          ORDER BY updated_at DESC`,
    args: [currentSupportEnvironment()],
  });
  return (result.rows || []).map((row) => ({
    endpointHash: String(row.endpoint_hash || ''),
    subscription: {
      endpoint: String(row.endpoint || ''),
      keys: {
        p256dh: String(row.p256dh || ''),
        auth: String(row.auth || ''),
      },
    },
  })).filter((item) => item.endpointHash && item.subscription.endpoint);
}

async function subscriptionByDeviceToken(deviceToken) {
  await ensureSchema();
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT endpoint_hash, endpoint, p256dh, auth
          FROM support_push_subscriptions
          WHERE environment = ? AND device_token_hash = ? AND disabled_at = ''
          LIMIT 1`,
    args: [currentSupportEnvironment(), deviceTokenHash(deviceToken)],
  });
  const row = result.rows?.[0];
  if (!row) return null;
  return {
    endpointHash: String(row.endpoint_hash || ''),
    subscription: {
      endpoint: String(row.endpoint || ''),
      keys: {
        p256dh: String(row.p256dh || ''),
        auth: String(row.auth || ''),
      },
    },
  };
}

async function disableSubscription(eHash) {
  const db = await getSupportDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE support_push_subscriptions
          SET disabled_at = ?, updated_at = ?
          WHERE environment = ? AND endpoint_hash = ?`,
    args: [now, now, currentSupportEnvironment(), String(eHash || '')],
  });
}

async function sendPayload(target, payload, ttl = 86400) {
  if (!configureVapid()) {
    const error = new Error('Web Push belum configured.');
    error.code = 'WEBPUSH_NOT_CONFIGURED';
    throw error;
  }
  try {
    const response = await webpush.sendNotification(
      target.subscription,
      JSON.stringify(payload),
      { TTL: ttl, urgency: 'high' },
    );
    return { statusCode: Number(response?.statusCode || 201) };
  } catch (error) {
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      await disableSubscription(target.endpointHash).catch(() => {});
    }
    throw error;
  }
}

async function claimDelivery(deliveryKey, eHash) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - (5 * 60 * 1000)).toISOString();

  await db.execute({
    sql: `INSERT OR IGNORE INTO support_webpush_delivery (
            environment, delivery_key, endpoint_hash, status, updated_at
          ) VALUES (?, ?, ?, 'PENDING', ?)`,
    args: [environment, String(deliveryKey), String(eHash), now],
  });

  await db.execute({
    sql: `UPDATE support_webpush_delivery
          SET status = 'FAILED', last_error = 'stale_delivery_claim', updated_at = ?
          WHERE environment = ? AND delivery_key = ? AND endpoint_hash = ?
            AND status = 'SENDING' AND updated_at < ?`,
    args: [now, environment, String(deliveryKey), String(eHash), staleBefore],
  });

  const claimed = await db.execute({
    sql: `UPDATE support_webpush_delivery
          SET status = 'SENDING', last_error = '', updated_at = ?
          WHERE environment = ? AND delivery_key = ? AND endpoint_hash = ?
            AND status IN ('PENDING', 'FAILED')`,
    args: [now, environment, String(deliveryKey), String(eHash)],
  });
  return Number(claimed.rowsAffected || 0) > 0;
}

async function markDelivery(deliveryKey, eHash, status, errorText = '') {
  const db = await getSupportDb();
  await db.execute({
    sql: `UPDATE support_webpush_delivery
          SET status = ?, last_error = ?, updated_at = ?
          WHERE environment = ? AND delivery_key = ? AND endpoint_hash = ?`,
    args: [
      String(status),
      cleanText(errorText, 300),
      new Date().toISOString(),
      currentSupportEnvironment(),
      String(deliveryKey),
      String(eHash),
    ],
  });
}

function fallbackTier(amountCents) {
  const byAmount = new Map([
    [1000, '🤍 Supporter'],
    [2000, '🌟 Super Supporter'],
    [3000, '💎 Power Supporter'],
    [5000, '🏆 Ultimate Supporter'],
    [10000, '👑 Legend Supporter'],
  ]);
  return byAmount.get(Number(amountCents || 0)) || '❤️ Supporter';
}

function addOneCalendarYear(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const originalMonth = date.getUTCMonth();
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  date.setUTCMonth(originalMonth);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), originalMonth + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date;
}

function formatMalaysiaDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: MALAYSIA_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatMalaysiaTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: MALAYSIA_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

async function paymentRecord(orderNumber) {
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT o.order_number,
                 o.telegram_user_id,
                 o.telegram_username,
                 o.amount_cents,
                 o.status,
                 o.paid_at,
                 COALESCE(s.tier_label, '') AS tier_label
          FROM support_orders o
          LEFT JOIN support_submissions s
            ON s.environment = o.environment
           AND s.order_number = o.order_number
          WHERE o.environment = ?
            AND o.order_number = ?
          LIMIT 1`,
    args: [currentSupportEnvironment(), String(orderNumber || '')],
  });
  return result.rows?.[0] || null;
}

async function telegramDisplayName(userId, username = '') {
  try {
    const chat = await telegram('getChat', { chat_id: userId });
    const fullName = [chat?.first_name, chat?.last_name]
      .map((part) => cleanText(part, 80))
      .filter(Boolean)
      .join(' ')
      .trim();
    if (fullName) return fullName;
    if (chat?.username) return `@${String(chat.username).replace(/^@+/, '')}`;
  } catch (error) {
    console.warn('[webpush-payment] Telegram name lookup failed:', error?.message);
  }
  const fallbackUsername = cleanText(username, 64).replace(/^@+/, '');
  return fallbackUsername ? `@${fallbackUsername}` : '-';
}

function notificationPayload({ userId, amount, name, tierLabel, paidAt, expiresAt, tag }) {
  return {
    title: '',
    body: `ID ${userId} - RM${amount} - Successful ✅`,
    tag: cleanText(tag, 120),
    url: '/ar-payment',
  };
}

export async function notifyWebPushSupportPayment(orderNumber) {
  const order = String(orderNumber || '').trim();
  if (!order) return { sent: 0, reason: 'missing_order' };
  if (!isWebPushConfigured()) return { sent: 0, reason: 'not_configured' };

  const record = await paymentRecord(order);
  if (!record || String(record.status || '') !== 'PAID' || !record.paid_at) {
    return { sent: 0, reason: 'not_paid' };
  }

  const targets = await activeSubscriptions();
  if (!targets.length) return { sent: 0, reason: 'no_subscribers' };

  const userId = String(record.telegram_user_id || '');
  const amount = (Number(record.amount_cents || 0) / 100).toFixed(2);
  const tierLabel = cleanText(record.tier_label, 100) || fallbackTier(record.amount_cents);
  const name = await telegramDisplayName(userId, record.telegram_username);
  const paidAt = String(record.paid_at || '');
  const expiresAt = addOneCalendarYear(paidAt);
  const payload = notificationPayload({
    userId,
    amount,
    name,
    tierLabel,
    paidAt,
    expiresAt,
    tag: `payment-${order}`,
  });

  let sent = 0;
  let failed = 0;
  for (const target of targets) {
    const key = `order:${order}`;
    if (!(await claimDelivery(key, target.endpointHash))) continue;
    try {
      await sendPayload(target, payload);
      await markDelivery(key, target.endpointHash, 'SENT');
      sent += 1;
    } catch (error) {
      failed += 1;
      await markDelivery(key, target.endpointHash, 'FAILED', error?.message || 'send_failed').catch(() => {});
      console.warn('[webpush-payment] delivery failed:', error?.statusCode || '', error?.message);
    }
  }

  return { sent, failed };
}

export async function sendWebPushTest(deviceToken) {
  const token = String(deviceToken || '').trim();
  if (!token) {
    const error = new Error('Device token missing.');
    error.code = 'DEVICE_TOKEN_MISSING';
    throw error;
  }

  const target = await subscriptionByDeviceToken(token);
  if (!target) {
    const error = new Error('Device belum registered atau subscription expired.');
    error.code = 'PUSH_DEVICE_NOT_FOUND';
    throw error;
  }

  const payload = {
    title: '',
    body: 'ID 123456789 - RM10.00 - Successful ✅',
    tag: `test-${Date.now()}`,
    url: '/ar-payment',
  };

  await sendPayload(target, payload, 120);
  return { sent: true };
}
