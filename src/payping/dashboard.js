import { currentSupportEnvironment, getSupportDb } from '../support/store.js';
import { ensureSubmissionSchema } from '../support/submissions.js';
import { ensureWebPushSchema } from '../support/webpush-payment.js';
import { classifyPaymentStage, ensurePaymentFollowupSchema, getPaymentFollowupInfo } from '../support/payment-followup.js';

function money(value) {
  return (Math.max(0, Number(value || 0)) / 100).toFixed(2);
}

function clean(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

let dailyStatsSchemaPromise = null;

function malaysiaDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function ensurePayPingDailyStatsSchema(db) {
  if (!dailyStatsSchemaPromise) {
    dailyStatsSchemaPromise = db.execute(`
      CREATE TABLE IF NOT EXISTS payping_daily_stats (
        environment TEXT NOT NULL,
        local_date TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_user_id TEXT NOT NULL,
        received_cents INTEGER NOT NULL DEFAULT 0,
        successful_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (environment, local_date, scope_type, scope_user_id)
      )
    `).catch((error) => {
      dailyStatsSchemaPromise = null;
      throw error;
    });
  }
  return dailyStatsSchemaPromise;
}

function dailyScopeKey({ owner = false, role = 'user', userId = '' } = {}) {
  if (owner) return { type: 'owner', userId: '*' };
  const normalizedRole = String(role || 'user').toLowerCase() === 'affiliate'
    ? 'affiliate'
    : 'user';
  return {
    type: normalizedRole,
    userId: String(userId || ''),
  };
}

async function persistTodayStats(db, {
  environment,
  owner = false,
  role = 'user',
  userId = '',
  receivedCents = 0,
  successfulCount = 0,
} = {}) {
  await ensurePayPingDailyStatsSchema(db);
  const day = malaysiaDateKey();
  const scope = dailyScopeKey({ owner, role, userId });
  const now = new Date().toISOString();
  const cents = Math.max(0, Number(receivedCents || 0));
  const count = Math.max(0, Number(successfulCount || 0));

  await db.execute({
    sql: `INSERT INTO payping_daily_stats (
            environment, local_date, scope_type, scope_user_id,
            received_cents, successful_count, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(environment, local_date, scope_type, scope_user_id) DO UPDATE SET
            received_cents = MAX(payping_daily_stats.received_cents, excluded.received_cents),
            successful_count = MAX(payping_daily_stats.successful_count, excluded.successful_count),
            updated_at = excluded.updated_at`,
    args: [environment, day, scope.type, scope.userId, cents, count, now],
  });

  const result = await db.execute({
    sql: `SELECT received_cents, successful_count
          FROM payping_daily_stats
          WHERE environment = ? AND local_date = ?
            AND scope_type = ? AND scope_user_id = ?
          LIMIT 1`,
    args: [environment, day, scope.type, scope.userId],
  });
  const row = result.rows?.[0] || {};
  return {
    receivedCents: Number(row.received_cents || 0),
    successfulCount: Number(row.successful_count || 0),
  };
}

function paymentScope({ owner = false, role = 'user', userId = '' } = {}, alias = 'o') {
  if (owner) return { sql: '', args: [] };
  const id = String(userId || '').trim();
  if (String(role || '').toLowerCase() === 'affiliate') {
    return {
      sql: ` AND EXISTS (
        SELECT 1
        FROM affiliate_profiles ap
        WHERE ap.environment = ${alias}.environment
          AND ap.telegram_user_id = ${alias}.telegram_user_id
          AND ap.referred_by_user_id = ?
      )`,
      args: [id],
    };
  }
  return { sql: ` AND ${alias}.telegram_user_id = ?`, args: [id] };
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
    paymentStage: classifyPaymentStage({
      orderStatus: row.status,
      gatewayTransactionId: row.gateway_transaction_id,
      gatewayStatus: row.last_gateway_status,
      followupState: row.followup_state,
    }),
  };
}

export async function getPayPingDashboard({ userId, owner = false, role = 'user', limit = 8 } = {}) {
  await Promise.all([ensureSubmissionSchema(), ensurePaymentFollowupSchema()]);
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const scope = paymentScope({ userId, owner, role });
  const args = [env, ...scope.args];

  const [summaryResult, recentResult] = await Promise.all([
    db.execute({
      sql: `SELECT
              COUNT(*) AS total_count,
              COALESCE(SUM(CASE WHEN o.status = 'PAID' THEN 1 ELSE 0 END),0) AS paid_count,
              COALESCE(SUM(CASE WHEN o.status != 'PAID' THEN 1 ELSE 0 END),0) AS pending_count,
              COUNT(DISTINCT CASE WHEN o.status = 'PAID' THEN o.telegram_user_id END) AS supporter_count,
              COALESCE(SUM(CASE WHEN o.status IN ('FAILED','CANCELLED','EXPIRED','INTENT_FAILED','AMOUNT_MISMATCH') THEN 1 ELSE 0 END),0) AS failed_count,
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
            WHERE o.environment = ?${scope.sql}`,
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
            WHERE o.environment = ?${scope.sql}
            ORDER BY COALESCE(o.paid_at, o.created_at) DESC
            LIMIT ?`,
      args: [...args, Math.max(1, Math.min(25, Number(limit || 8)))],
    }),
  ]);

  const s = summaryResult.rows?.[0] || {};
  const persistedToday = await persistTodayStats(db, {
    environment: env,
    owner,
    role,
    userId,
    receivedCents: Number(s.today_cents || 0),
    successfulCount: Number(s.today_count || 0),
  });

  return {
    owner,
    summary: {
      totalTransactions: Number(s.total_count || 0),
      paidTransactions: Number(s.paid_count || 0),
      pendingTransactions: Number(s.pending_count || 0),
      supporters: Number(s.supporter_count || 0),
      failedTransactions: Number(s.failed_count || 0),
      totalReceived: money(s.paid_cents),
      todayReceived: money(persistedToday.receivedCents),
      todayTransactions: persistedToday.successfulCount,
    },
    recent: (recentResult.rows || []).map(transactionRow),
  };
}

export async function listPayPingTransactions({
  userId,
  owner = false,
  role = 'user',
  status = 'ALL',
  search = '',
  limit = 50,
} = {}) {
  await Promise.all([ensureSubmissionSchema(), ensurePaymentFollowupSchema()]);
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const clauses = ['o.environment = ?'];
  const args = [env];

  if (!owner) {
    const scope = paymentScope({ userId, owner, role });
    if (scope.sql) clauses.push(scope.sql.replace(/^\s*AND\s+/i, ''));
    args.push(...scope.args);
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
                 COALESCE(s.display_name, '') AS display_name,
                 COALESCE(f.state, '') AS followup_state
          FROM support_orders o
          LEFT JOIN support_submissions s
            ON s.environment = o.environment
           AND s.order_number = o.order_number
          LEFT JOIN support_payment_followups f
            ON f.environment = o.environment
           AND f.order_number = o.order_number
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
  role = 'user',
  orderNumber = '',
} = {}) {
  const order = clean(orderNumber, 120);
  if (!order) return null;

  await Promise.all([ensureSubmissionSchema(), ensureWebPushSchema(), ensurePaymentFollowupSchema()]);
  const db = await getSupportDb();
  const env = currentSupportEnvironment();

  const clauses = ['o.environment = ?', 'o.order_number = ?'];
  const args = [env, order];
  if (!owner) {
    const scope = paymentScope({ userId, owner, role });
    if (scope.sql) clauses.push(scope.sql.replace(/^\s*AND\s+/i, ''));
    args.push(...scope.args);
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
                 COALESCE(s.announced_at, '') AS announced_at,
                 COALESCE(s.checkout_open_count, 0) AS checkout_open_count,
                 COALESCE(s.checkout_first_opened_at, '') AS checkout_first_opened_at,
                 COALESCE(s.checkout_last_opened_at, '') AS checkout_last_opened_at,
                 COALESCE(f.state, '') AS followup_state
          FROM support_orders o
          LEFT JOIN support_submissions s
            ON s.environment = o.environment
           AND s.order_number = o.order_number
          LEFT JOIN support_payment_followups f
            ON f.environment = o.environment
           AND f.order_number = o.order_number
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
      sql: `SELECT d.status, d.last_error, d.updated_at
            FROM support_webpush_delivery d
            JOIN support_push_subscriptions ps
              ON ps.environment = d.environment
             AND ps.endpoint_hash = d.endpoint_hash
            WHERE d.environment = ?
              AND d.delivery_key LIKE ?
              ${owner ? '' : 'AND ps.owner_user_id = ?'}
            ORDER BY d.updated_at DESC`,
      args: owner
        ? [env, `order:${order}:%`]
        : [env, `order:${order}:%`, String(userId || '')],
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

  const affiliateViewer = !owner && String(role || '').toLowerCase() === 'affiliate';
  const followup = (owner || affiliateViewer)
    ? await getPaymentFollowupInfo(order, {
        viewerRole: owner ? 'owner' : 'affiliate',
        viewerUserId: String(userId || ''),
      }).catch(() => null)
    : null;

  return {
    owner,
    role: String(role || 'user'),
    followup,
    transaction: {
      ...transaction,
      paymentIntentId: owner && row.payment_intent_id ? String(row.payment_intent_id) : '',
      errorCode: row.error_code ? String(row.error_code) : '',
      updatedAt: String(row.updated_at || ''),
      tierKey: String(row.tier_key || ''),
      supportMessage: String(row.support_message || ''),
      submissionState: String(row.submission_state || ''),
      checkoutOpened: Number(row.checkout_open_count || 0) > 0,
      checkoutOpenCount: Number(row.checkout_open_count || 0),
      checkoutFirstOpenedAt: row.checkout_first_opened_at ? String(row.checkout_first_opened_at) : null,
      checkoutLastOpenedAt: row.checkout_last_opened_at ? String(row.checkout_last_opened_at) : null,
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


function analyticsRange(value) {
  const key = clean(value, 16).toLowerCase();
  if (key === '7d') return { key, days: 7, modifier: '-6 days', label: 'Last 7 days' };
  if (key === '90d') return { key, days: 90, modifier: '-89 days', label: 'Last 90 days' };
  return { key: '30d', days: 30, modifier: '-29 days', label: 'Last 30 days' };
}

function paidRangeSql(alias, range) {
  return `${alias}.status = 'PAID'
    AND date(datetime(${alias}.paid_at, '+8 hours'))
      >= date(datetime('now', '+8 hours'), '${range.modifier}')`;
}

export async function getPayPingAnalytics({ owner = false, range = '30d' } = {}) {
  if (!owner) {
    const error = new Error('PayPing Analytics hanya untuk merchant owner.');
    error.code = 'PAYPING_OWNER_ONLY';
    throw error;
  }

  await ensureSubmissionSchema();
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const selected = analyticsRange(range);
  const paidScope = paidRangeSql('o', selected);

  const [
    summaryResult,
    dailyResult,
    monthlyResult,
    tierResult,
    supportersResult,
    affiliateResult,
  ] = await Promise.all([
    db.execute({
      sql: `SELECT
              COUNT(*) AS paid_count,
              COALESCE(SUM(o.amount_cents), 0) AS received_cents,
              COALESCE(AVG(o.amount_cents), 0) AS average_cents,
              COUNT(DISTINCT o.telegram_user_id) AS unique_supporters
            FROM support_orders o
            WHERE o.environment = ? AND ${paidScope}`,
      args: [env],
    }),
    db.execute({
      sql: `SELECT
              date(datetime(o.paid_at, '+8 hours')) AS bucket,
              COUNT(*) AS payment_count,
              COALESCE(SUM(o.amount_cents), 0) AS amount_cents
            FROM support_orders o
            WHERE o.environment = ? AND ${paidScope}
            GROUP BY bucket
            ORDER BY bucket ASC`,
      args: [env],
    }),
    db.execute({
      sql: `SELECT
              strftime('%Y-%m', datetime(o.paid_at, '+8 hours')) AS bucket,
              COUNT(*) AS payment_count,
              COALESCE(SUM(o.amount_cents), 0) AS amount_cents
            FROM support_orders o
            WHERE o.environment = ?
              AND o.status = 'PAID'
              AND date(datetime(o.paid_at, '+8 hours'))
                >= date(datetime('now', '+8 hours'), 'start of month', '-11 months')
            GROUP BY bucket
            ORDER BY bucket ASC`,
      args: [env],
    }),
    db.execute({
      sql: `SELECT
              COALESCE(NULLIF(s.tier_label, ''), 'Supporter') AS tier_label,
              COUNT(*) AS payment_count,
              COALESCE(SUM(o.amount_cents), 0) AS amount_cents
            FROM support_orders o
            LEFT JOIN support_submissions s
              ON s.environment = o.environment
             AND s.order_number = o.order_number
            WHERE o.environment = ? AND ${paidScope}
            GROUP BY tier_label
            ORDER BY amount_cents DESC, payment_count DESC`,
      args: [env],
    }),
    db.execute({
      sql: `SELECT
              o.telegram_user_id,
              MAX(COALESCE(NULLIF(s.display_name, ''), '')) AS display_name,
              MAX(COALESCE(NULLIF(o.telegram_username, ''), '')) AS telegram_username,
              COUNT(*) AS payment_count,
              COALESCE(SUM(o.amount_cents), 0) AS amount_cents
            FROM support_orders o
            LEFT JOIN support_submissions s
              ON s.environment = o.environment
             AND s.order_number = o.order_number
            WHERE o.environment = ? AND ${paidScope}
            GROUP BY o.telegram_user_id
            ORDER BY amount_cents DESC, payment_count DESC
            LIMIT 10`,
      args: [env],
    }),
    db.execute({
      sql: `SELECT
              COALESCE(SUM(a.commission_cents), 0) AS generated_cents,
              COALESCE(SUM(CASE WHEN a.status = 'PAID' THEN a.commission_cents ELSE 0 END), 0) AS paid_cents,
              COUNT(*) AS commission_count
            FROM affiliate_commissions a
            JOIN support_orders o
              ON o.environment = a.environment
             AND o.order_number = a.order_number
            WHERE a.environment = ? AND ${paidScope}`,
      args: [env],
    }),
  ]);

  const summary = summaryResult.rows?.[0] || {};
  const affiliate = affiliateResult.rows?.[0] || {};
  const receivedCents = Number(summary.received_cents || 0);
  const affiliateCents = Number(affiliate.generated_cents || 0);

  return {
    range: selected,
    summary: {
      received: money(receivedCents),
      payments: Number(summary.paid_count || 0),
      averagePayment: money(summary.average_cents),
      uniqueSupporters: Number(summary.unique_supporters || 0),
      affiliateCost: money(affiliateCents),
      affiliatePaid: money(affiliate.paid_cents),
      affiliateCommissions: Number(affiliate.commission_count || 0),
      netAfterAffiliate: money(Math.max(0, receivedCents - affiliateCents)),
    },
    daily: (dailyResult.rows || []).map((row) => ({
      date: String(row.bucket || ''),
      payments: Number(row.payment_count || 0),
      amount: money(row.amount_cents),
    })),
    monthly: (monthlyResult.rows || []).map((row) => ({
      month: String(row.bucket || ''),
      payments: Number(row.payment_count || 0),
      amount: money(row.amount_cents),
    })),
    tiers: (tierResult.rows || []).map((row) => ({
      tier: String(row.tier_label || 'Supporter'),
      payments: Number(row.payment_count || 0),
      amount: money(row.amount_cents),
    })),
    topSupporters: (supportersResult.rows || []).map((row) => ({
      userId: String(row.telegram_user_id || ''),
      displayName: String(row.display_name || ''),
      username: String(row.telegram_username || ''),
      payments: Number(row.payment_count || 0),
      amount: money(row.amount_cents),
    })),
  };
}

export async function getPayPingAnalyticsExport({ owner = false, range = '30d', limit = 5000 } = {}) {
  if (!owner) {
    const error = new Error('PayPing Reports hanya untuk merchant owner.');
    error.code = 'PAYPING_OWNER_ONLY';
    throw error;
  }

  await ensureSubmissionSchema();
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const selected = analyticsRange(range);
  const paidScope = paidRangeSql('o', selected);
  const safeLimit = Math.max(1, Math.min(5000, Number(limit || 5000)));

  const result = await db.execute({
    sql: `SELECT o.order_number, o.gateway_transaction_id, o.telegram_user_id,
                 o.telegram_username, o.amount_cents, o.status, o.paid_at,
                 COALESCE(s.display_name, '') AS display_name,
                 COALESCE(s.tier_label, '') AS tier_label,
                 COALESCE(a.commission_cents, 0) AS affiliate_cents,
                 COALESCE(a.status, '') AS affiliate_status
          FROM support_orders o
          LEFT JOIN support_submissions s
            ON s.environment = o.environment
           AND s.order_number = o.order_number
          LEFT JOIN affiliate_commissions a
            ON a.environment = o.environment
           AND a.order_number = o.order_number
          WHERE o.environment = ? AND ${paidScope}
          ORDER BY o.paid_at DESC
          LIMIT ?`,
    args: [env, safeLimit],
  });

  return {
    range: selected,
    rows: (result.rows || []).map((row) => ({
      orderNumber: String(row.order_number || ''),
      transactionId: String(row.gateway_transaction_id || ''),
      userId: String(row.telegram_user_id || ''),
      username: String(row.telegram_username || ''),
      displayName: String(row.display_name || ''),
      tier: String(row.tier_label || '') || 'Supporter',
      amount: money(row.amount_cents),
      status: String(row.status || ''),
      paidAt: String(row.paid_at || ''),
      affiliateCommission: money(row.affiliate_cents),
      affiliateStatus: String(row.affiliate_status || ''),
    })),
  };
}
