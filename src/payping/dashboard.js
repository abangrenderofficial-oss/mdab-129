import { currentSupportEnvironment, getSupportDb } from '../support/store.js';
import { ensureSubmissionSchema } from '../support/submissions.js';

function money(value) {
  return (Math.max(0, Number(value || 0)) / 100).toFixed(2);
}

function clean(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function transactionRow(row) {
  return {
    orderNumber: String(row.order_number || ''),
    userId: String(row.telegram_user_id || ''),
    username: String(row.telegram_username || ''),
    amount: money(row.amount_cents),
    status: String(row.status || ''),
    gatewayStatus: row.last_gateway_status ? String(row.last_gateway_status) : '',
    statusDescription: String(row.status_description || ''),
    transactionId: row.gateway_transaction_id ? String(row.gateway_transaction_id) : '',
    tierLabel: String(row.tier_label || '') || 'Supporter',
    displayName: String(row.display_name || ''),
    createdAt: String(row.created_at || ''),
    paidAt: row.paid_at ? String(row.paid_at) : null,
  };
}

export async function getPayPingDashboard({ userId, owner = false, limit = 8 } = {}) {
  await ensureSubmissionSchema();
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const args = [env];
  const scope = owner ? '' : ' AND o.telegram_user_id = ?';
  if (!owner) args.push(String(userId || ''));

  const [summaryResult, recentResult] = await Promise.all([
    db.execute({
      sql: `SELECT
              COUNT(*) AS total_count,
              COALESCE(SUM(CASE WHEN o.status = 'PAID' THEN 1 ELSE 0 END),0) AS paid_count,
              COALESCE(SUM(CASE WHEN o.status != 'PAID' THEN 1 ELSE 0 END),0) AS pending_count,
              COALESCE(SUM(CASE WHEN o.status = 'PAID' THEN o.amount_cents ELSE 0 END),0) AS paid_cents,
              COALESCE(SUM(CASE
                WHEN o.status = 'PAID'
                 AND date(datetime(o.paid_at, '+8 hours')) = date(datetime('now', '+8 hours'))
                THEN o.amount_cents ELSE 0 END),0) AS today_cents,
              COALESCE(SUM(CASE
                WHEN o.status = 'PAID'
                 AND date(datetime(o.paid_at, '+8 hours')) = date(datetime('now', '+8 hours'))
                THEN 1 ELSE 0 END),0) AS today_count
            FROM support_orders o
            WHERE o.environment = ?${scope}`,
      args,
    }),
    db.execute({
      sql: `SELECT o.order_number, o.telegram_user_id, o.telegram_username,
                   o.amount_cents, o.status, o.last_gateway_status,
                   o.status_description, o.gateway_transaction_id,
                   o.created_at, o.paid_at,
                   COALESCE(s.tier_label, '') AS tier_label,
                   COALESCE(s.display_name, '') AS display_name
            FROM support_orders o
            LEFT JOIN support_submissions s
              ON s.environment = o.environment
             AND s.order_number = o.order_number
            WHERE o.environment = ?${scope}
            ORDER BY COALESCE(o.paid_at, o.created_at) DESC
            LIMIT ?`,
      args: [...args, Math.max(1, Math.min(25, Number(limit || 8)))],
    }),
  ]);

  const s = summaryResult.rows?.[0] || {};
  return {
    owner,
    summary: {
      totalTransactions: Number(s.total_count || 0),
      paidTransactions: Number(s.paid_count || 0),
      pendingTransactions: Number(s.pending_count || 0),
      totalReceived: money(s.paid_cents),
      todayReceived: money(s.today_cents),
      todayTransactions: Number(s.today_count || 0),
    },
    recent: (recentResult.rows || []).map(transactionRow),
  };
}

export async function listPayPingTransactions({
  userId,
  owner = false,
  status = 'ALL',
  search = '',
  limit = 50,
} = {}) {
  await ensureSubmissionSchema();
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const clauses = ['o.environment = ?'];
  const args = [env];

  if (!owner) {
    clauses.push('o.telegram_user_id = ?');
    args.push(String(userId || ''));
  }

  const normalizedStatus = clean(status, 24).toUpperCase();
  if (normalizedStatus && normalizedStatus !== 'ALL') {
    clauses.push('o.status = ?');
    args.push(normalizedStatus);
  }

  const q = clean(search, 80);
  if (q) {
    clauses.push(`(
      o.order_number LIKE ? OR
      o.gateway_transaction_id LIKE ? OR
      o.telegram_user_id LIKE ? OR
      o.telegram_username LIKE ? OR
      s.display_name LIKE ?
    )`);
    const like = `%${q}%`;
    args.push(like, like, like, like, like);
  }

  const result = await db.execute({
    sql: `SELECT o.order_number, o.telegram_user_id, o.telegram_username,
                 o.amount_cents, o.status, o.last_gateway_status,
                 o.status_description, o.gateway_transaction_id,
                 o.created_at, o.paid_at,
                 COALESCE(s.tier_label, '') AS tier_label,
                 COALESCE(s.display_name, '') AS display_name
          FROM support_orders o
          LEFT JOIN support_submissions s
            ON s.environment = o.environment
           AND s.order_number = o.order_number
          WHERE ${clauses.join(' AND ')}
          ORDER BY COALESCE(o.paid_at, o.created_at) DESC
          LIMIT ?`,
    args: [...args, Math.max(1, Math.min(100, Number(limit || 50)))],
  });

  return (result.rows || []).map(transactionRow);
}
