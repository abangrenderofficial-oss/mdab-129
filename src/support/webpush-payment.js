import { createHash, randomBytes, randomInt } from 'node:crypto';
import webpush from 'web-push';

import { currentSupportEnvironment, getSupportDb } from './store.js';
import { telegram } from '../telegram.js';

const MALAYSIA_TIMEZONE = 'Asia/Kuala_Lumpur';
const SETUP_CODE_TTL_MS = 10 * 60 * 1000;
const UNSUCCESSFUL_PAYMENT_STATUSES = new Set([
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'INTENT_FAILED',
  'AMOUNT_MISMATCH',
]);
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

export async function ensureWebPushSchema() {
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

  await ensureWebPushSchema();
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

async function persistPushSubscription(ownerUserId, subscription) {
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

  const userId = String(ownerUserId || '').trim();
  if (!/^\d+$/.test(userId) || Number(userId) <= 0) {
    const error = new Error('Telegram account belum linked dengan PayPing.');
    error.code = 'PAYPING_TELEGRAM_LINK_REQUIRED';
    throw error;
  }

  await ensureWebPushSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
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
      userId,
      now,
      now,
    ],
  });

  return { deviceToken: token };
}

export async function registerPushSubscriptionForUser(ownerUserId, subscription) {
  return persistPushSubscription(ownerUserId, subscription);
}

export async function registerPushSubscription(code, subscription) {
  if (!configureVapid()) {
    const error = new Error('Web Push belum configured.');
    error.code = 'WEBPUSH_NOT_CONFIGURED';
    throw error;
  }

  if (!validSubscription(subscription)) {
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

  await ensureWebPushSchema();
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

  return persistPushSubscription(String(row.owner_user_id || ''), subscription);
}

async function activeSubscriptionsForUsers(userIds = []) {
  await ensureWebPushSchema();
  const ids = [...new Set((userIds || [])
    .map((value) => String(value || '').trim())
    .filter((value) => /^\d+$/.test(value) && Number(value) > 0))];
  if (!ids.length) return [];

  const db = await getSupportDb();
  const placeholders = ids.map(() => '?').join(',');
  const result = await db.execute({
    sql: `SELECT endpoint_hash, endpoint, p256dh, auth, owner_user_id
          FROM support_push_subscriptions
          WHERE environment = ? AND disabled_at = ''
            AND owner_user_id IN (${placeholders})
          ORDER BY updated_at DESC`,
    args: [currentSupportEnvironment(), ...ids],
  });
  return (result.rows || []).map((row) => ({
    endpointHash: String(row.endpoint_hash || ''),
    ownerUserId: String(row.owner_user_id || ''),
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
  await ensureWebPushSchema();
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

export async function resolvePushDeviceOwner(deviceToken) {
  const token = String(deviceToken || '').trim();
  if (!token) return null;

  await ensureWebPushSchema();
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT owner_user_id
          FROM support_push_subscriptions
          WHERE environment = ? AND device_token_hash = ? AND disabled_at = ''
          LIMIT 1`,
    args: [currentSupportEnvironment(), deviceTokenHash(token)],
  });
  const userId = String(result.rows?.[0]?.owner_user_id || '').trim();
  return /^\d+$/.test(userId) && Number(userId) > 0 ? userId : null;
}

export async function getPushDeviceContext(deviceToken) {
  const token = String(deviceToken || '').trim();
  if (!token) return null;

  await ensureWebPushSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const tokenHash = deviceTokenHash(token);

  const currentResult = await db.execute({
    sql: `SELECT endpoint_hash, endpoint, owner_user_id, created_at, updated_at, disabled_at
          FROM support_push_subscriptions
          WHERE environment = ? AND device_token_hash = ?
          LIMIT 1`,
    args: [environment, tokenHash],
  });
  const current = currentResult.rows?.[0];
  if (!current || current.disabled_at) return null;

  const ownerUserId = String(current.owner_user_id || '');
  const devicesResult = await db.execute({
    sql: `SELECT endpoint_hash, endpoint, created_at, updated_at, disabled_at
          FROM support_push_subscriptions
          WHERE environment = ? AND owner_user_id = ?
          ORDER BY updated_at DESC`,
    args: [environment, ownerUserId],
  });

  const devices = (devicesResult.rows || []).map((row) => {
    let endpointHost = '';
    try { endpointHost = new URL(String(row.endpoint || '')).hostname; } catch {}
    return {
      id: String(row.endpoint_hash || ''),
      current: String(row.endpoint_hash || '') === String(current.endpoint_hash || ''),
      active: !String(row.disabled_at || ''),
      endpointHost,
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
      disabledAt: row.disabled_at ? String(row.disabled_at) : null,
    };
  });

  return {
    ownerUserId,
    currentDeviceId: String(current.endpoint_hash || ''),
    currentCreatedAt: String(current.created_at || ''),
    currentUpdatedAt: String(current.updated_at || ''),
    devices,
    activeDeviceCount: devices.filter((device) => device.active).length,
  };
}

export async function getPushNotificationHistory(deviceToken, limit = 50) {
  const context = await getPushDeviceContext(deviceToken);
  if (!context) {
    const error = new Error('Device belum registered atau subscription expired.');
    error.code = 'PUSH_DEVICE_NOT_FOUND';
    throw error;
  }

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 50)));
  const result = await db.execute({
    sql: `SELECT d.delivery_key, d.endpoint_hash, d.status, d.last_error, d.updated_at
          FROM support_webpush_delivery d
          JOIN support_push_subscriptions s
            ON s.environment = d.environment
           AND s.endpoint_hash = d.endpoint_hash
          WHERE d.environment = ?
            AND s.owner_user_id = ?
          ORDER BY d.updated_at DESC
          LIMIT ?`,
    args: [environment, context.ownerUserId, safeLimit],
  });

  return (result.rows || []).map((row) => ({
    deliveryKey: String(row.delivery_key || ''),
    deviceId: String(row.endpoint_hash || ''),
    currentDevice: String(row.endpoint_hash || '') === context.currentDeviceId,
    status: String(row.status || ''),
    lastError: String(row.last_error || ''),
    updatedAt: String(row.updated_at || ''),
  }));
}

export async function disconnectPushDevice(deviceToken) {
  const token = String(deviceToken || '').trim();
  if (!token) {
    const error = new Error('Device token missing.');
    error.code = 'DEVICE_TOKEN_MISSING';
    throw error;
  }

  await ensureWebPushSchema();
  const db = await getSupportDb();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `UPDATE support_push_subscriptions
          SET disabled_at = ?, updated_at = ?
          WHERE environment = ? AND device_token_hash = ? AND disabled_at = ''`,
    args: [now, now, currentSupportEnvironment(), deviceTokenHash(token)],
  });
  if (Number(result.rowsAffected || 0) < 1) {
    const error = new Error('Device belum registered atau sudah disconnected.');
    error.code = 'PUSH_DEVICE_NOT_FOUND';
    throw error;
  }
  return { disconnected: true };
}

export async function revokePushDevice(deviceToken, targetDeviceId) {
  const context = await getPushDeviceContext(deviceToken);
  if (!context) {
    const error = new Error('Device belum registered atau subscription expired.');
    error.code = 'PUSH_DEVICE_NOT_FOUND';
    throw error;
  }

  const target = String(targetDeviceId || '').trim();
  if (!target) {
    const error = new Error('Target device missing.');
    error.code = 'PUSH_DEVICE_NOT_FOUND';
    throw error;
  }

  const db = await getSupportDb();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `UPDATE support_push_subscriptions
          SET disabled_at = ?, updated_at = ?
          WHERE environment = ? AND owner_user_id = ?
            AND endpoint_hash = ? AND disabled_at = ''`,
    args: [now, now, currentSupportEnvironment(), context.ownerUserId, target],
  });
  if (Number(result.rowsAffected || 0) < 1) {
    const error = new Error('Device tidak dijumpai atau sudah disconnected.');
    error.code = 'PUSH_DEVICE_NOT_FOUND';
    throw error;
  }

  return {
    disconnected: true,
    currentDevice: target === context.currentDeviceId,
    deviceId: target,
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
  await ensureWebPushSchema();
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
                 COALESCE(s.tier_label, '') AS tier_label,
                 COALESCE(p.referred_by_user_id, '') AS referrer_user_id,
                 COALESCE(r.telegram_username, '') AS referrer_username,
                 COALESCE(a.email, '') AS referrer_email
          FROM support_orders o
          LEFT JOIN support_submissions s
            ON s.environment = o.environment
           AND s.order_number = o.order_number
          LEFT JOIN affiliate_profiles p
            ON p.environment = o.environment
           AND p.telegram_user_id = o.telegram_user_id
          LEFT JOIN affiliate_profiles r
            ON r.environment = p.environment
           AND r.telegram_user_id = p.referred_by_user_id
          LEFT JOIN payping_accounts a
            ON a.telegram_user_id = p.referred_by_user_id
           AND a.status = 'active'
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

function notificationPayload({
  userId,
  amount,
  tierLabel,
  orderNumber,
  successful,
  actionable = false,
  affiliateSource = '',
}) {
  const tierName = cleanText(tierLabel, 100)
    .replace(/^[^A-Za-z0-9]+/, '')
    .trim() || 'Supporter';

  const sourceLine = cleanText(affiliateSource, 100);
  const payload = {
    title: `Payment Receive, ${tierName}`,
    body: `ID ${userId} - RM ${amount} - ${successful ? 'successful 🎉' : 'unsuccessful 🥹'}${sourceLine ? `\nvia ${sourceLine} 🫱🏻‍🫲🏼` : ''}`,
    tag: `payment-${cleanText(orderNumber, 100)}-${successful ? 'success' : 'unsuccessful'}`,
    url: `/ar-payment/transaction?order=${encodeURIComponent(String(orderNumber || ''))}`,
    orderNumber: String(orderNumber || ''),
    actionable: Boolean(actionable && !successful),
  };

  if (payload.actionable) {
    payload.actions = [
      { action: 'follow_up', title: 'Follow Up ✅' },
      { action: 'dont_follow_up', title: 'Don’t Follow Up ❌' },
    ];
  }
  return payload;
}

async function notificationRecipients(record = {}) {
  const recipients = new Set();
  const ownerId = String(process.env.BOT_OWNER_ID || '').trim();
  if (/^\d+$/.test(ownerId) && Number(ownerId) > 0) recipients.add(ownerId);

  const referrerId = String(record.referrer_user_id || '').trim();
  if (/^\d+$/.test(referrerId) && Number(referrerId) > 0) recipients.add(referrerId);

  const payerId = String(record.telegram_user_id || '').trim();
  if (/^\d+$/.test(payerId) && Number(payerId) > 0) recipients.add(payerId);

  return [...recipients];
}

export async function notifyWebPushSupportPayment(orderNumber) {
  const order = String(orderNumber || '').trim();
  if (!order) return { sent: 0, reason: 'missing_order' };
  if (!isWebPushConfigured()) return { sent: 0, reason: 'not_configured' };

  const record = await paymentRecord(order);
  if (!record) return { sent: 0, reason: 'order_not_found' };

  const status = String(record.status || '').trim().toUpperCase();
  if (!status || status === 'CREATING') return { sent: 0, reason: 'not_ready' };

  const successful = status === 'PAID' && Boolean(record.paid_at);
  if (!successful && !UNSUCCESSFUL_PAYMENT_STATUSES.has(status)) {
    return {
      sent: 0,
      failed: 0,
      successful: false,
      status,
      reason: 'non_terminal_payment_status',
    };
  }

  const recipientIds = await notificationRecipients(record);
  const targets = await activeSubscriptionsForUsers(recipientIds);
  if (!targets.length) return { sent: 0, reason: 'no_scoped_subscribers', recipients: recipientIds };

  const userId = String(record.telegram_user_id || '');
  const amount = (Number(record.amount_cents || 0) / 100).toFixed(2);
  const tierLabel = cleanText(record.tier_label, 100) || fallbackTier(record.amount_cents);
  const ownerId = String(process.env.BOT_OWNER_ID || '').trim();
  const referrerId = String(record.referrer_user_id || '').trim();
  const referrerUsername = cleanText(record.referrer_username, 64).replace(/^@+/, '');
  const referrerEmail = cleanText(record.referrer_email, 160).toLowerCase();
  const referrerEmailName = cleanText(referrerEmail.split('@')[0], 80);
  const affiliateSource = referrerId
    ? (referrerUsername ? `@${referrerUsername}` : referrerEmailName)
    : '';

  const deliveryKey = `order:${order}:${successful ? 'PAID' : status}`;
  let sent = 0;
  let failed = 0;
  for (const target of targets) {
    if (!(await claimDelivery(deliveryKey, target.endpointHash))) continue;
    const actionable = !successful && (
      String(target.ownerUserId || '') === ownerId
      || (referrerId && String(target.ownerUserId || '') === referrerId)
    );
    const isOwnerRecipient = Boolean(ownerId && String(target.ownerUserId || '') === ownerId);
    const payload = notificationPayload({
      userId,
      amount,
      tierLabel,
      orderNumber: order,
      successful,
      actionable,
      affiliateSource: isOwnerRecipient ? affiliateSource : '',
    });
    try {
      await sendPayload(target, payload);
      await markDelivery(deliveryKey, target.endpointHash, 'SENT');
      sent += 1;
    } catch (error) {
      failed += 1;
      await markDelivery(deliveryKey, target.endpointHash, 'FAILED', error?.message || 'send_failed').catch(() => {});
      console.warn('[webpush-payment] delivery failed:', error?.statusCode || '', error?.message);
    }
  }

  return {
    sent,
    failed,
    successful,
    status,
    recipients: recipientIds,
  };
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

  const testTiers = [
    { tier: 'Supporter', amount: '10.00' },
    { tier: 'Super Supporter', amount: '20.00' },
    { tier: 'Power Supporter', amount: '30.00' },
    { tier: 'Ultimate Supporter', amount: '50.00' },
    { tier: 'Legend Supporter', amount: '100.00' },
  ];
  const testTier = testTiers[randomInt(0, testTiers.length)];
  const testUserId = String(randomInt(100000000, 1000000000));

  const payload = {
    title: `Payment Received, ${testTier.tier}`,
    body: `ID ${testUserId} - RM ${testTier.amount} - successful 🎉`,
    tag: `test-${Date.now()}-${testUserId}`,
    url: '/ar-payment',
  };

  await sendPayload(target, payload, 120);
  return { sent: true };
}
