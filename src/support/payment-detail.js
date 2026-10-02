import { currentSupportEnvironment, getSupportDb } from './store.js';
import { getTelegramChat, sendMessage, telegram } from '../telegram.js';

const MALAYSIA_TIMEZONE = 'Asia/Kuala_Lumpur';
let schemaPromise = null;

function cleanText(value, maxLength = 160) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
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

  const lastDay = new Date(Date.UTC(
    date.getUTCFullYear(),
    originalMonth + 1,
    0,
  )).getUTCDate();
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
      await db.batch([
        `CREATE TABLE IF NOT EXISTS support_payment_detail_config (
          environment TEXT NOT NULL PRIMARY KEY,
          group_id TEXT NOT NULL,
          group_title TEXT NOT NULL DEFAULT '',
          updated_by TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS support_payment_detail_delivery (
          environment TEXT NOT NULL,
          order_number TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          group_id TEXT NOT NULL DEFAULT '',
          message_id TEXT NOT NULL DEFAULT '',
          last_error TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, order_number)
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

export async function setPaymentDetailGroup(chatId, title = '', adminUserId = '') {
  const groupId = String(chatId || '').trim();
  if (!/^-?\d+$/.test(groupId)) throw new Error('Invalid payment detail group ID.');

  const chat = await getTelegramChat(groupId);
  if (!['group', 'supergroup'].includes(chat?.type)) {
    const error = new Error('Payment detail destination must be a Telegram group or supergroup.');
    error.code = 'PAYMENT_DETAIL_GROUP_REQUIRED';
    throw error;
  }

  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO support_payment_detail_config (
            environment, group_id, group_title, updated_by, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(environment) DO UPDATE SET
            group_id = excluded.group_id,
            group_title = excluded.group_title,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
    args: [
      environment,
      groupId,
      cleanText(title, 160),
      String(adminUserId || ''),
      now,
    ],
  });

  return { groupId, title: cleanText(title, 160), updatedAt: now };
}

export async function getPaymentDetailGroup() {
  await ensureSchema();
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT group_id, group_title, updated_at
          FROM support_payment_detail_config
          WHERE environment = ?
          LIMIT 1`,
    args: [currentSupportEnvironment()],
  });
  const row = result.rows?.[0];
  if (!row?.group_id) return null;
  return {
    groupId: String(row.group_id),
    title: String(row.group_title || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

async function paymentRecord(orderNumber) {
  await ensureSchema();
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
    console.warn('[payment-detail] Telegram name lookup failed:', error?.message);
  }

  const fallbackUsername = cleanText(username, 64).replace(/^@+/, '');
  return fallbackUsername ? `@${fallbackUsername}` : '-';
}

async function claimDelivery(orderNumber, groupId) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - (5 * 60 * 1000)).toISOString();

  await db.execute({
    sql: `INSERT OR IGNORE INTO support_payment_detail_delivery (
            environment, order_number, status, group_id, updated_at
          ) VALUES (?, ?, 'PENDING', ?, ?)`,
    args: [environment, String(orderNumber), String(groupId), now],
  });

  await db.execute({
    sql: `UPDATE support_payment_detail_delivery
          SET status = 'FAILED', last_error = 'stale_delivery_claim', updated_at = ?
          WHERE environment = ? AND order_number = ?
            AND status = 'SENDING' AND updated_at < ?`,
    args: [now, environment, String(orderNumber), staleBefore],
  });

  const claimed = await db.execute({
    sql: `UPDATE support_payment_detail_delivery
          SET status = 'SENDING', group_id = ?, last_error = '', updated_at = ?
          WHERE environment = ? AND order_number = ?
            AND status IN ('PENDING', 'FAILED')`,
    args: [String(groupId), now, environment, String(orderNumber)],
  });
  return Number(claimed.rowsAffected || 0) > 0;
}

async function markDelivery(orderNumber, status, messageId = '', errorText = '') {
  const db = await getSupportDb();
  await db.execute({
    sql: `UPDATE support_payment_detail_delivery
          SET status = ?, message_id = ?, last_error = ?, updated_at = ?
          WHERE environment = ? AND order_number = ?`,
    args: [
      String(status),
      String(messageId || ''),
      cleanText(errorText, 300),
      new Date().toISOString(),
      currentSupportEnvironment(),
      String(orderNumber || ''),
    ],
  });
}

export async function notifySuccessfulSupportPayment(orderNumber) {
  const order = String(orderNumber || '').trim();
  if (!order) return { sent: false, reason: 'missing_order' };

  const target = await getPaymentDetailGroup();
  if (!target?.groupId) return { sent: false, reason: 'not_connected' };

  const record = await paymentRecord(order);
  if (!record || String(record.status || '') !== 'PAID' || !record.paid_at) {
    return { sent: false, reason: 'not_paid' };
  }

  const claimed = await claimDelivery(order, target.groupId);
  if (!claimed) return { sent: false, reason: 'already_sent_or_sending' };

  const userId = String(record.telegram_user_id || '');
  const amount = (Number(record.amount_cents || 0) / 100).toFixed(2);
  const tierLabel = cleanText(record.tier_label, 100) || fallbackTier(record.amount_cents);
  const name = await telegramDisplayName(userId, record.telegram_username);
  const paidAt = String(record.paid_at || '');
  const expiresAt = addOneCalendarYear(paidAt);

  const text = [
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
    const sent = await sendMessage(target.groupId, text);
    await markDelivery(order, 'SENT', sent?.message_id || '');
    return { sent: true, groupId: target.groupId, messageId: sent?.message_id || null };
  } catch (error) {
    await markDelivery(order, 'FAILED', '', error?.message || 'send_failed').catch(() => {});
    throw error;
  }
}
