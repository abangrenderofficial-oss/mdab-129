import { currentSupportEnvironment, getSupportDb } from './store.js';
import { getSupportSubmission } from './submissions.js';

function validUserId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : '';
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function addOneCalendarMonth(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date;
}

export async function saveSupportTestimonial(orderNumber, supportMessage, displayName) {
  const order = String(orderNumber || '').trim();
  if (!order) return null;

  const existing = await getSupportSubmission(order);
  if (!existing || existing.announcedAt) return existing;

  const message = cleanText(supportMessage, 500);
  const name = cleanText(displayName, 80);
  if (!message || !name) return existing;

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();

  await db.execute({
    sql: `UPDATE support_submissions
          SET support_message = ?, display_name = ?, state = 'READY', updated_at = ?
          WHERE environment = ? AND order_number = ? AND announced_at IS NULL`,
    args: [message, name, now, environment, order],
  });

  return getSupportSubmission(order);
}

export async function getActiveSupporterTitle(userId) {
  const telegramUserId = validUserId(userId);
  if (!telegramUserId) return null;

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();

  let rows = [];
  try {
    const result = await db.execute({
      sql: `SELECT s.order_number, s.tier_key, s.tier_label, s.amount_cents,
                   s.display_name, o.paid_at
            FROM support_submissions s
            INNER JOIN support_orders o
              ON o.environment = s.environment AND o.order_number = s.order_number
            WHERE s.environment = ? AND s.telegram_user_id = ?
              AND o.paid_at IS NOT NULL AND o.status = 'PAID'
            ORDER BY o.paid_at DESC
            LIMIT 20`,
      args: [environment, telegramUserId],
    });
    rows = Array.isArray(result.rows) ? result.rows : [];
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('no such table')) return null;
    throw error;
  }

  const now = Date.now();
  const active = rows
    .map((row) => {
      const expiresAt = addOneCalendarMonth(row.paid_at);
      if (!expiresAt || expiresAt.getTime() <= now) return null;
      return {
        orderNumber: String(row.order_number || ''),
        tierKey: String(row.tier_key || ''),
        tierLabel: String(row.tier_label || '') || '❤️ Supporter',
        amount: (Number(row.amount_cents || 0) / 100).toFixed(2),
        displayName: String(row.display_name || ''),
        paidAt: String(row.paid_at || ''),
        expiresAt: expiresAt.toISOString(),
        amountCents: Number(row.amount_cents || 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.amountCents - a.amountCents || String(b.paidAt).localeCompare(String(a.paidAt)));

  if (!active.length) return null;
  const best = active[0];
  delete best.amountCents;
  return best;
}
