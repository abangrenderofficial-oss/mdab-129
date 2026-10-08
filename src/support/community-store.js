import { currentSupportEnvironment, getSupportDb } from './store.js';
import { getSupportSubmission } from './submissions.js';
import {supportExpiryFromSnapshot} from './payping-order-plan.js';

function validUserId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : '';
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
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

function normalizedTier(row = {}) {
  const amountCents = Number(row.amount_cents || 0);
  const byAmount = new Map([
    [100, { key: 'coffee', label: '☕️ Cofee Supporter' }],
    [1000, { key: 'supporter', label: '🤍 Supporter' }],
    [2000, { key: 'super', label: '🌟 Super Supporter' }],
    [3000, { key: 'power', label: '💎 Power Supporter' }],
    [5000, { key: 'ultimate', label: '🏆 Ultimate Supporter' }],
    [10000, { key: 'legend', label: '👑 Legend Supporter' }],
  ]);

  if (byAmount.has(amountCents)) return byAmount.get(amountCents);

  return {
    key: String(row.tier_key || ''),
    label: String(row.tier_label || '') || '❤️ Supporter',
  };
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
      sql: `SELECT o.order_number,
                   COALESCE(s.tier_key, '') AS tier_key,
                   COALESCE(s.tier_label, '') AS tier_label,
                   o.amount_cents,
                   COALESCE(s.display_name, '') AS display_name,
                   o.paid_at,
                   plan.duration_days AS snapshot_duration_days
            FROM support_orders o
            LEFT JOIN payping_order_plan_snapshots_v2 plan ON plan.environment=o.environment AND plan.order_number=o.order_number
            LEFT JOIN support_submissions s
              ON s.environment = o.environment AND s.order_number = o.order_number
            WHERE o.environment = ? AND o.telegram_user_id = ?
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
      const expiresAt = row.snapshot_duration_days===null||row.snapshot_duration_days===undefined
        ? addOneCalendarYear(row.paid_at)
        : supportExpiryFromSnapshot(row.paid_at,row.snapshot_duration_days);
      if (!expiresAt || expiresAt.getTime() <= now) return null;
      const tier = normalizedTier(row);
      return {
        orderNumber: String(row.order_number || ''),
        tierKey: tier.key,
        tierLabel: tier.label,
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
