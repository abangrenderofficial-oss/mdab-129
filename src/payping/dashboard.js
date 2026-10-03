import { currentSupportEnvironment, getSupportDb } from '../support/store.js';
import { ensureSubmissionSchema } from '../support/submissions.js';
import { ensureWebPushSchema } from '../support/webpush-payment.js';

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


export async function getPayPingTransactionDetail({
  userId,
  owner = false,
  orderNumber = '',
} = {}) {
  const order = clean(orderNumber, 120);
  if (!order) return null;

  await Promise.all([ensureSubmissionSchema(), ensureWebPushSchema()]);
  const db = await getSupportDb();
  const env = currentSupportEnvironment();

  const clauses = ['o.environment = ?', 'o.order_number = ?'];
  const args = [env, order];
  if (!owner) {
    clauses.push('o.telegram_user_id = ?');
    args.push(String(userId || ''));
  }

  const orderResult = await db.execute({
    sql: `SELECT o.order_number, o.telegram_user_id, o.telegram_username,
                 o.amount_cents, o.status, o.payment_intent_id, o.error_code,
                 o.last_gateway_status, o.status_description,
                 o.gateway_transaction_id, o.created_at, o.updated_at, o.paid_at,
                 COALESCE(s.tier_key, '') AS tier_key,
                 COALESCE(s.tier_label, '') AS tier_label,
                 COALESCE(s.support_message, '') AS support_message,
                 COALESCE(s.display_name, '') AS display_name,
                 COALESCE(s.state, '') AS submission_state,
                 COALESCE(s.announced_at, '') AS announced_at
          FROM support_orders o
          LEFT JOIN support_submissions s
            ON s.environment = o.environment
           AND s.order_number = o.order_number
          WHERE ${clauses.join(' AND ')}
          LIMIT 1`,
    args,
  });
  const row = orderResult.rows?.[0];
  if (!row) return null;

  const [callbacksResult, affiliateResult, pushResult] = await Promise.all([
    db.execute({
      sql: `SELECT transaction_id, gateway_status, amount_cents, received_at, updated_at
            FROM support_transactions
            WHERE environment = ? AND order_number = ?
            ORDER BY received_at ASC, updated_at ASC`,
      args: [env, order],
    }),
    db.execute({
      sql: `SELECT commission_id, referrer_user_id, referred_user_id,
                   gross_cents, rate_bps, commission_cents, status,
                   available_at, payout_request_id, created_at, updated_at
            FROM affiliate_commissions
            WHERE environment = ? AND order_number = ?
            LIMIT 1`,
      args: [env, order],
    }),
    db.execute({
      sql: `SELECT status, last_error, updated_at
            FROM support_webpush_delivery
            WHERE environment = ? AND delivery_key = ?
            ORDER BY updated_at DESC`,
      args: [env, `order:${order}`],
    }),
  ]);

  const transaction = transactionRow(row);
  const affiliateRow = affiliateResult.rows?.[0] || null;
  const pushRows = pushResult.rows || [];
  const callbacks = (callbacksResult.rows || []).map((item) => ({
    transactionId: item.transaction_id ? String(item.transaction_id) : '',
    gatewayStatus: String(item.gateway_status || ''),
    amount: money(item.amount_cents),
    receivedAt: String(item.received_at || ''),
    updatedAt: String(item.updated_at || ''),
  }));

  const sentCount = pushRows.filter((item) => String(item.status || '') === 'SENT').length;
  const failedCount = pushRows.filter((item) => String(item.status || '') === 'FAILED').length;

  return {
    owner,
    transaction: {
      ...transaction,
      paymentIntentId: owner && row.payment_intent_id ? String(row.payment_intent_id) : '',
      errorCode: row.error_code ? String(row.error_code) : '',
      updatedAt: String(row.updated_at || ''),
      tierKey: String(row.tier_key || ''),
      supportMessage: String(row.support_message || ''),
      submissionState: String(row.submission_state || ''),
      announcedAt: row.announced_at ? String(row.announced_at) : null,
    },
    callbacks,
    affiliate: affiliateRow
      ? owner
        ? {
            generated: true,
            commissionId: String(affiliateRow.commission_id || ''),
            referrerUserId: String(affiliateRow.referrer_user_id || ''),
            referredUserId: String(affiliateRow.referred_user_id || ''),
            grossAmount: money(affiliateRow.gross_cents),
            ratePercent: (Number(affiliateRow.rate_bps || 0) / 100).toFixed(2).replace(/\.00$/, ''),
            commissionAmount: money(affiliateRow.commission_cents),
            status: String(affiliateRow.status || ''),
            availableAt: String(affiliateRow.available_at || ''),
            payoutRequestId: affiliateRow.payout_request_id ? String(affiliateRow.payout_request_id) : '',
            createdAt: String(affiliateRow.created_at || ''),
            updatedAt: String(affiliateRow.updated_at || ''),
          }
        : { generated: true }
      : { generated: false },
    notification: {
      deliveries: pushRows.map((item) => ({
        status: String(item.status || ''),
        lastError: String(item.last_error || ''),
        updatedAt: String(item.updated_at || ''),
      })),
      total: pushRows.length,
      sent: sentCount,
      failed: failedCount,
    },
  };
}
