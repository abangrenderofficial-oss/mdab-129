import { currentSupportEnvironment, getSupportDb } from './store.js';
import { telegram } from '../telegram.js';

const MALAYSIA_TIMEZONE = 'Asia/Kuala_Lumpur';
const NTFY_BASE_URL = 'https://ntfy.sh';
let schemaPromise = null;

function cleanText(value, maxLength = 160) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function configuredTopic() {
  const topic = String(process.env.NTFY_PAYMENT_TOPIC || '').trim();
  return /^[A-Za-z0-9_-]{1,200}$/.test(topic) ? topic : '';
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

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.execute(`CREATE TABLE IF NOT EXISTS support_ntfy_delivery (
        environment TEXT NOT NULL,
        delivery_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        message_id TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (environment, delivery_key)
      )`);
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function claimDelivery(deliveryKey) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - (5 * 60 * 1000)).toISOString();

  await db.execute({
    sql: `INSERT OR IGNORE INTO support_ntfy_delivery (
            environment, delivery_key, status, updated_at
          ) VALUES (?, ?, 'PENDING', ?)`,
    args: [environment, String(deliveryKey), now],
  });

  await db.execute({
    sql: `UPDATE support_ntfy_delivery
          SET status = 'FAILED', last_error = 'stale_delivery_claim', updated_at = ?
          WHERE environment = ? AND delivery_key = ?
            AND status = 'SENDING' AND updated_at < ?`,
    args: [now, environment, String(deliveryKey), staleBefore],
  });

  const claimed = await db.execute({
    sql: `UPDATE support_ntfy_delivery
          SET status = 'SENDING', last_error = '', updated_at = ?
          WHERE environment = ? AND delivery_key = ?
            AND status IN ('PENDING', 'FAILED')`,
    args: [now, environment, String(deliveryKey)],
  });

  return Number(claimed.rowsAffected || 0) > 0;
}

async function markDelivery(deliveryKey, status, messageId = '', errorText = '') {
  const db = await getSupportDb();
  await db.execute({
    sql: `UPDATE support_ntfy_delivery
          SET status = ?, message_id = ?, last_error = ?, updated_at = ?
          WHERE environment = ? AND delivery_key = ?`,
    args: [
      String(status),
      cleanText(messageId, 120),
      cleanText(errorText, 300),
      new Date().toISOString(),
      currentSupportEnvironment(),
      String(deliveryKey),
    ],
  });
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
    console.warn('[ntfy-payment] Telegram name lookup failed:', error?.message);
  }
  const fallbackUsername = cleanText(username, 64).replace(/^@+/, '');
  return fallbackUsername ? `@${fallbackUsername}` : '-';
}

async function publishNtfy(body) {
  const topic = configuredTopic();
  if (!topic) return { sent: false, reason: 'not_configured' };

  const response = await fetch(`${NTFY_BASE_URL}/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Title': 'AR Payment',
      'X-Priority': 'high',
    },
    body,
    signal: AbortSignal.timeout(10000),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`ntfy publish failed: HTTP ${response.status} ${responseText.slice(0, 200)}`);
  }

  let payload = null;
  try { payload = JSON.parse(responseText); } catch {}
  return {
    sent: true,
    messageId: String(payload?.id || ''),
  };
}

export async function notifyNtfySupportPayment(orderNumber) {
  const order = String(orderNumber || '').trim();
  if (!order) return { sent: false, reason: 'missing_order' };
  if (!configuredTopic()) return { sent: false, reason: 'not_configured' };

  const record = await paymentRecord(order);
  if (!record || String(record.status || '') !== 'PAID' || !record.paid_at) {
    return { sent: false, reason: 'not_paid' };
  }

  const deliveryKey = `order:${order}`;
  if (!(await claimDelivery(deliveryKey))) {
    return { sent: false, reason: 'already_sent_or_sending' };
  }

  const userId = String(record.telegram_user_id || '');
  const amount = (Number(record.amount_cents || 0) / 100).toFixed(2);
  const tierLabel = cleanText(record.tier_label, 100) || fallbackTier(record.amount_cents);
  const name = await telegramDisplayName(userId, record.telegram_username);
  const paidAt = String(record.paid_at || '');
  const expiresAt = addOneCalendarYear(paidAt);

  const body = [
    `ID ${userId} - RM${amount} - Successful ✅`,
    '',
    `ID user - ${userId}`,
    `Nama - ${name}`,
    `Amount - RM${amount}`,
    `Type of support - ${tierLabel}`,
    `Date - ${formatMalaysiaDate(paidAt)}`,
    `Time - ${formatMalaysiaTime(paidAt)}`,
    `Period - ${formatMalaysiaDate(paidAt)} sampai ${formatMalaysiaDate(expiresAt)} (12 bulan)`,
  ].join('\n');

  try {
    const sent = await publishNtfy(body);
    await markDelivery(deliveryKey, 'SENT', sent.messageId || '');
    return sent;
  } catch (error) {
    await markDelivery(deliveryKey, 'FAILED', '', error?.message || 'send_failed').catch(() => {});
    throw error;
  }
}

export async function sendNtfyPaymentPreviewOnce() {
  if (!configuredTopic()) return { sent: false, reason: 'not_configured' };
  const deliveryKey = '__TEST_NTFY_IPHONE_PREVIEW_V1__';
  if (!(await claimDelivery(deliveryKey))) {
    return { sent: false, reason: 'already_sent_or_sending' };
  }

  const body = [
    'ID 123456789 - RM10.00 - Successful ✅',
    '',
    'ID user - 123456789',
    'Nama - Test User',
    'Amount - RM10.00',
    'Type of support - 🤍 Supporter',
    'Date - 3 Oct 2026',
    'Time - 1:24:00 AM',
    'Period - 3 Oct 2026 sampai 3 Oct 2027 (12 bulan)',
  ].join('\n');

  try {
    const sent = await publishNtfy(body);
    await markDelivery(deliveryKey, 'SENT', sent.messageId || '');
    return sent;
  } catch (error) {
    await markDelivery(deliveryKey, 'FAILED', '', error?.message || 'send_failed').catch(() => {});
    throw error;
  }
}
