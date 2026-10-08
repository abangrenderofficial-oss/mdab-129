import { currentSupportEnvironment, getSupportDb } from './store.js';
import {
  activateSupportSubmissionAfterPayment,
  cancelSupportSubmission,
  ensureSubmissionSchema,
  getSupportSubmission,
} from './submissions.js';
import { reconcileSupportPayment } from './reconcile.js';
import { notifySuccessfulSupportPayment } from './payment-detail.js';
import { notifyWebPushSupportPayment } from './webpush-payment.js';
import { notifyNtfySupportPayment } from './ntfy-payment.js';
import { notifyAffiliateCommission } from '../affiliate/notify.js';
import { sendMessage, telegram } from '../telegram.js';
import {refreshSupportAmounts} from './payping-shared-config.js';

const FIRST_FOLLOWUP_MS = 15 * 60 * 1000;
const SECOND_FOLLOWUP_MS = 8 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;
const MAX_FOLLOWUPS = 2;
const AFFILIATE_FOLLOWUP_COOLDOWN_MS = 8 * 60 * 60 * 1000;
const AFFILIATE_MAX_FOLLOWUPS = 2;
const FINAL_ORDER_STATUSES = new Set([
  'PAID',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'INTENT_FAILED',
  'AMOUNT_MISMATCH',
]);
const TERMINAL_INTENT_STATUSES = new Map([
  ['failed', 'FAILED'],
  ['cancelled', 'CANCELLED'],
  ['canceled', 'CANCELLED'],
  ['expired', 'EXPIRED'],
]);

let schemaPromise = null;
let schedulerTimer = null;
let cycleRunning = false;

function money(value) {
  const cents = Number(value || 0);
  return (Number.isFinite(cents) ? cents / 100 : 0).toFixed(2);
}

function clean(value, max = 300) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

export function classifyPaymentStage({
  orderStatus = '',
  gatewayTransactionId = '',
  gatewayStatus = '',
  followupState = '',
} = {}) {
  const status = String(orderStatus || '').trim().toUpperCase();
  const followup = String(followupState || '').trim().toUpperCase();
  if (followup === 'REVIEW') return 'PAYMENT_REVIEW';
  if (FINAL_ORDER_STATUSES.has(status)) return status;
  if (status === 'PENDING') {
    return gatewayTransactionId || gatewayStatus ? 'PAYMENT_PENDING' : 'CHECKOUT_PENDING';
  }
  return status || 'UNKNOWN';
}

export async function ensurePaymentFollowupSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS support_payment_followups (
          environment TEXT NOT NULL,
          order_number TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'ACTIVE',
          followup_count INTEGER NOT NULL DEFAULT 0,
          last_followup_at TEXT,
          last_message_id TEXT NOT NULL DEFAULT '',
          last_attempt_at TEXT,
          last_delivery_status TEXT NOT NULL DEFAULT '',
          last_error_code TEXT NOT NULL DEFAULT '',
          last_error TEXT NOT NULL DEFAULT '',
          review_at TEXT,
          stopped_at TEXT,
          stopped_reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, order_number)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_support_payment_followups_state
          ON support_payment_followups(environment, state, followup_count, last_followup_at)`,
        `CREATE TABLE IF NOT EXISTS support_auto_followup_rollout_v3 (
          environment TEXT NOT NULL PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 1,
          activated_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS support_auto_followup_claims_v3 (
          environment TEXT NOT NULL,
          order_number TEXT NOT NULL,
          sequence_no INTEGER NOT NULL,
          claimed_at TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'sending',
          PRIMARY KEY(environment,order_number,sequence_no)
        )`,
        `CREATE TABLE IF NOT EXISTS support_affiliate_followups (
          environment TEXT NOT NULL,
          order_number TEXT NOT NULL,
          affiliate_user_id TEXT NOT NULL,
          followup_count INTEGER NOT NULL DEFAULT 0,
          last_followup_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, order_number, affiliate_user_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_support_affiliate_followups_user
          ON support_affiliate_followups(environment, affiliate_user_id, last_followup_at)`,
      ], 'write');

      for (const statement of [
        `ALTER TABLE support_payment_followups ADD COLUMN last_attempt_at TEXT`,
        `ALTER TABLE support_payment_followups ADD COLUMN last_delivery_status TEXT NOT NULL DEFAULT ''`,
        `ALTER TABLE support_payment_followups ADD COLUMN last_error_code TEXT NOT NULL DEFAULT ''`,
        `ALTER TABLE support_payment_followups ADD COLUMN last_error TEXT NOT NULL DEFAULT ''`,
      ]) {
        await db.execute(statement).catch((error) => {
          if (!/duplicate column|already exists/i.test(String(error?.message || ''))) throw error;
        });
      }
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function followupRow(orderNumber) {
  await ensurePaymentFollowupSchema();
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT state, followup_count, last_followup_at, last_message_id,
                 last_attempt_at, last_delivery_status, last_error_code, last_error,
                 review_at, stopped_at, stopped_reason, created_at, updated_at
          FROM support_payment_followups
          WHERE environment = ? AND order_number = ?
          LIMIT 1`,
    args: [env, String(orderNumber || '')],
  });
  return result.rows?.[0] || null;
}

async function ensureFollowupRow(orderNumber) {
  await ensurePaymentFollowupSchema();
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT OR IGNORE INTO support_payment_followups (
            environment, order_number, state, followup_count,
            last_followup_at, last_message_id, review_at,
            stopped_at, stopped_reason, created_at, updated_at
          ) VALUES (?, ?, 'ACTIVE', 0, NULL, '', NULL, NULL, '', ?, ?)`,
    args: [env, String(orderNumber || ''), now, now],
  });
  return followupRow(orderNumber);
}

async function orderContext(orderNumber) {
  await Promise.all([ensurePaymentFollowupSchema(), ensureSubmissionSchema()]);
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT o.order_number, o.telegram_user_id, o.telegram_username,
                 o.amount_cents, o.status, o.payment_intent_id,
                 o.last_gateway_status, o.gateway_transaction_id,
                 o.created_at, o.updated_at, o.paid_at,
                 COALESCE(s.payment_url, '') AS payment_url,
                 COALESCE(s.state, '') AS submission_state,
                 COALESCE(s.tier_label, '') AS tier_label,
                 COALESCE(f.state, '') AS followup_state,
                 COALESCE(f.followup_count, 0) AS followup_count,
                 f.last_followup_at, f.last_attempt_at,
                 COALESCE(f.last_delivery_status, '') AS last_delivery_status,
                 COALESCE(f.last_error_code, '') AS last_error_code,
                 COALESCE(f.last_error, '') AS last_error,
                 f.review_at, f.stopped_at,
                 COALESCE(f.stopped_reason, '') AS stopped_reason,
                 COALESCE(ap.referred_by_user_id, '') AS referrer_user_id
          FROM support_orders o
          LEFT JOIN support_submissions s
            ON s.environment = o.environment
           AND s.order_number = o.order_number
          LEFT JOIN support_payment_followups f
            ON f.environment = o.environment
           AND f.order_number = o.order_number
          LEFT JOIN affiliate_profiles ap
            ON ap.environment = o.environment
           AND ap.telegram_user_id = o.telegram_user_id
          WHERE o.environment = ? AND o.order_number = ?
          LIMIT 1`,
    args: [env, String(orderNumber || '')],
  });
  return result.rows?.[0] || null;
}

async function markFollowupState(orderNumber, state, reason = '') {
  await ensureFollowupRow(orderNumber);
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const now = new Date().toISOString();
  const next = String(state || '').toUpperCase();
  await db.execute({
    sql: `UPDATE support_payment_followups
          SET state = ?,
              review_at = CASE WHEN ? = 'REVIEW' THEN COALESCE(review_at, ?) ELSE review_at END,
              stopped_at = CASE WHEN ? IN ('STOPPED','RESOLVED') THEN COALESCE(stopped_at, ?) ELSE stopped_at END,
              stopped_reason = CASE WHEN ? <> '' THEN ? ELSE stopped_reason END,
              updated_at = ?
          WHERE environment = ? AND order_number = ?`,
    args: [
      next,
      next,
      now,
      next,
      now,
      clean(reason, 120),
      clean(reason, 120),
      now,
      env,
      String(orderNumber || ''),
    ],
  });
  return followupRow(orderNumber);
}

async function markIntentTerminal(orderNumber, status, description = '') {
  const next = TERMINAL_INTENT_STATUSES.get(String(status || '').toLowerCase());
  if (!next) return false;
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE support_orders
          SET status = ?, status_description = CASE WHEN ? <> '' THEN ? ELSE status_description END,
              updated_at = ?
          WHERE environment = ? AND order_number = ? AND paid_at IS NULL`,
    args: [next, clean(description, 200), clean(description, 200), now, env, String(orderNumber || '')],
  });
  return true;
}

async function notifyPaidFromReconcile(status) {
  const result = status?.result;
  if (!result?.becamePaid || !result?.orderNumber) return;

  if (result?.affiliate?.created) {
    await notifyAffiliateCommission(result.affiliate).catch((error) => {
      console.warn('[payment-followup] affiliate notification failed:', error?.message);
    });
  }
  await notifySuccessfulSupportPayment(result.orderNumber).catch((error) => {
    console.warn('[payment-followup] payment detail notification failed:', error?.message);
  });
  await notifyNtfySupportPayment(result.orderNumber).catch((error) => {
    console.warn('[payment-followup] ntfy notification failed:', error?.message);
  });

  const submission = await getSupportSubmission(result.orderNumber).catch(() => null);
  const tier = submission?.tierLabel || result?.tier?.label || '❤️ Supporter';
  await sendMessage(
    result.telegramUserId,
    [
      '❤️ Payment dah confirm ✅',
      result.amount ? `Support diterima: RM${result.amount}` : '',
      `Title 12 bulan: ${tier}`,
    ].filter(Boolean).join('\n'),
  ).catch((error) => {
    console.warn('[payment-followup] user paid confirmation failed:', error?.message);
  });

  const activation = await activateSupportSubmissionAfterPayment(result.orderNumber).catch(() => null);
  if (activation?.activated) {
    await sendMessage(result.telegramUserId, 'Tinggalkan kata-kata support korang ❤️').catch(() => {});
  }
}

export async function reconcilePaymentFollowup(orderNumber) {
  const row = await orderContext(orderNumber);
  if (!row) {
    const error = new Error('Payment order tidak dijumpai.');
    error.code = 'PAYMENT_ORDER_NOT_FOUND';
    throw error;
  }

  if (FINAL_ORDER_STATUSES.has(String(row.status || '').toUpperCase())) {
    await markFollowupState(orderNumber, 'RESOLVED', String(row.status || '').toUpperCase());
    return {
      paid: String(row.status || '').toUpperCase() === 'PAID',
      orderStatus: String(row.status || ''),
      stage: classifyPaymentStage({
        orderStatus: row.status,
        gatewayTransactionId: row.gateway_transaction_id,
        gatewayStatus: row.last_gateway_status,
        followupState: row.followup_state,
      }),
      resolved: true,
    };
  }

  let status = null;
  try {
    status = await reconcileSupportPayment({
      paymentIntentId: String(row.payment_intent_id || ''),
      orderNumber: String(row.order_number || ''),
    });
  } catch (error) {
    console.warn('[payment-followup] Bayarcash reconcile failed:', error?.code, error?.status, error?.message);
    return {
      paid: false,
      resolved: false,
      lookupFailed: true,
      error: error?.code || error?.message || 'RECONCILE_FAILED',
      orderStatus: String(row.status || ''),
      stage: classifyPaymentStage({
        orderStatus: row.status,
        gatewayTransactionId: row.gateway_transaction_id,
        gatewayStatus: row.last_gateway_status,
        followupState: row.followup_state,
      }),
    };
  }

  await notifyPaidFromReconcile(status);
  if (status?.paid) {
    await markFollowupState(orderNumber, 'RESOLVED', 'PAID');
  } else if (TERMINAL_INTENT_STATUSES.has(String(status?.intentStatus || '').toLowerCase())) {
    await markIntentTerminal(orderNumber, status.intentStatus, status.statusDescription || '');
    await markFollowupState(orderNumber, 'RESOLVED', String(status.intentStatus || '').toUpperCase());
  }

  const fresh = await orderContext(orderNumber);
  const orderStatus = String(fresh?.status || row.status || '');
  const terminalUnsuccessful = FINAL_ORDER_STATUSES.has(orderStatus.toUpperCase())
    && orderStatus.toUpperCase() !== 'PAID';
  if (!status?.paid && terminalUnsuccessful && orderNumber) {
    await notifyWebPushSupportPayment(orderNumber).catch((error) => {
      console.warn('[payment-followup] unsuccessful push notification failed:', error?.message);
    });
  }
  const resolved = FINAL_ORDER_STATUSES.has(orderStatus.toUpperCase()) || Boolean(status?.paid);
  return {
    paid: Boolean(status?.paid),
    resolved,
    lookupFailed: false,
    intentStatus: status?.intentStatus || '',
    transactionStatus: status?.transactionStatus || '',
    transactionId: status?.transactionId || '',
    amount: status?.amount || money(row.amount_cents),
    orderStatus,
    stage: classifyPaymentStage({
      orderStatus,
      gatewayTransactionId: fresh?.gateway_transaction_id,
      gatewayStatus: fresh?.last_gateway_status,
      followupState: fresh?.followup_state,
    }),
  };
}

function followupAmountLabel(row) {
  const value = Number(row?.amount_cents || 0) / 100;
  if (!Number.isFinite(value)) return 'RM0';
  return `RM${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}`;
}

function normalizeFollowupIdentity(value = '') {
  const text = String(value || '')
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (text.match(/[\p{L}\p{N}]/gu)?.length || 0) >= 2 ? text.slice(0, 80) : '';
}

async function followupRecipient(row) {
  const username = normalizeFollowupIdentity(String(row?.telegram_username || '').replace(/^@+/, ''));
  if (username) return `@${username}`;

  try {
    const chat = await telegram('getChat', { chat_id: row?.telegram_user_id });
    const name = normalizeFollowupIdentity([chat?.first_name, chat?.last_name].filter(Boolean).join(' '));
    if (name) return name;
  } catch (error) {
    console.warn('[payment-followup] Telegram name lookup failed:', error?.code, error?.message);
  }

  return '';
}

function followupText(row, recipient = '') {
  const amount = followupAmountLabel(row);
  return [
    recipient ? `Hi, ${recipient}!😊` : 'Hi, Supporter! 😊',
    '',
    `Awak ada checkout ${amount} tapi belum confirmkan? Kalau awak suka guna bot ni and masih nak sama2 bantu bot kita semua kekal hidup 🥹🇲🇾`,
    '',
    'Awak boleh continue pembayaran. Terima kasih orang baik! ❤️✨',
    '',
    'Kalau ada masalah pembayaran pm @abangrenderofficial',
  ].join('\n');
}

async function followupKeyboard(row) {
  const amounts=await refreshSupportAmounts().catch(()=>[10,20,30,50,100]);
  const active=amounts.map(Number).filter(x=>Number.isFinite(x)&&x>=1&&x<=1000000);
  const rows=[];
  for(let i=0;i<active.length;i+=3){
    rows.push(active.slice(i,i+3).map(v=>({
      text:'RM'+(Number.isInteger(v)?String(v):v.toFixed(2)),
      callback_data:'support:select:'+String(v)
    })));
  }
  return {inline_keyboard:[
    ...rows,
    [{text:'✅ Dah Bayar / Semak',callback_data:`payfollow:review:${row.order_number}`}],
    [{text:'✖️ Tak Jadi',callback_data:`payfollow:cancel:${row.order_number}`}],
  ]};
}

function telegramDeliveryError(error) {
  const raw = String(error?.message || '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('bot was blocked by the user')) {
    return {
      code: 'TELEGRAM_BOT_BLOCKED',
      status: 'BLOCKED',
      message: 'Follow-up gagal — user telah block bot.',
      stopAuto: true,
    };
  }
  if (lower.includes('user is deactivated')) {
    return {
      code: 'TELEGRAM_USER_DEACTIVATED',
      status: 'UNAVAILABLE',
      message: 'Follow-up gagal — akaun Telegram user tidak aktif.',
      stopAuto: true,
    };
  }
  if (lower.includes('chat not found')) {
    return {
      code: 'TELEGRAM_CHAT_UNAVAILABLE',
      status: 'UNAVAILABLE',
      message: 'Follow-up gagal — private chat Telegram user tidak tersedia.',
      stopAuto: true,
    };
  }
  return {
    code: String(error?.code || 'TELEGRAM_SEND_FAILED'),
    status: 'FAILED',
    message: 'Follow-up gagal dihantar ke Telegram user.',
    stopAuto: false,
  };
}

async function recordFollowupFailure(orderNumber, delivery) {
  await ensureFollowupRow(orderNumber);
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE support_payment_followups
          SET state = CASE WHEN ? THEN 'STOPPED' ELSE state END,
              stopped_at = CASE WHEN ? THEN COALESCE(stopped_at, ?) ELSE stopped_at END,
              stopped_reason = CASE WHEN ? THEN ? ELSE stopped_reason END,
              last_attempt_at = ?,
              last_delivery_status = ?,
              last_error_code = ?,
              last_error = ?,
              updated_at = ?
          WHERE environment = ? AND order_number = ?`,
    args: [
      delivery.stopAuto ? 1 : 0,
      delivery.stopAuto ? 1 : 0,
      now,
      delivery.stopAuto ? 1 : 0,
      delivery.code,
      now,
      delivery.status,
      delivery.code,
      clean(delivery.message, 240),
      now,
      env,
      String(orderNumber || ''),
    ],
  });
}

async function recordFollowupSent(orderNumber, messageId = '', { reactivate = true } = {}) {
  await ensureFollowupRow(orderNumber);
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE support_payment_followups
          SET state = CASE WHEN ? THEN 'ACTIVE' ELSE state END,
              followup_count = followup_count + 1,
              last_followup_at = ?,
              last_message_id = ?,
              last_attempt_at = ?,
              last_delivery_status = 'SENT',
              last_error_code = '',
              last_error = '',
              stopped_at = CASE WHEN ? THEN NULL ELSE stopped_at END,
              stopped_reason = CASE WHEN ? THEN '' ELSE stopped_reason END,
              updated_at = ?
          WHERE environment = ? AND order_number = ?`,
    args: [
      reactivate ? 1 : 0,
      now,
      String(messageId || ''),
      now,
      reactivate ? 1 : 0,
      reactivate ? 1 : 0,
      now,
      env,
      String(orderNumber || ''),
    ],
  });
  return followupRow(orderNumber);
}

async function affiliateFollowupState(orderNumber, affiliateUserId) {
  await ensurePaymentFollowupSchema();
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT followup_count, last_followup_at
          FROM support_affiliate_followups
          WHERE environment = ? AND order_number = ? AND affiliate_user_id = ?
          LIMIT 1`,
    args: [env, String(orderNumber || ''), String(affiliateUserId || '')],
  });
  const row = result.rows?.[0];
  return {
    count: Number(row?.followup_count || 0),
    lastFollowupAt: row?.last_followup_at ? String(row.last_followup_at) : null,
  };
}

async function affiliateFollowupGate(row, affiliateUserId) {
  const actor = String(affiliateUserId || '').trim();
  if (!actor || String(row?.referrer_user_id || '') !== actor) {
    const error = new Error('Transaction ini bukan referral bawah affiliate account ini.');
    error.code = 'PAYMENT_FOLLOWUP_FORBIDDEN';
    throw error;
  }

  const state = await affiliateFollowupState(row.order_number, actor);
  if (state.count >= AFFILIATE_MAX_FOLLOWUPS) {
    const error = new Error('Follow-up affiliate untuk payment ini dah capai maksimum 2 kali.');
    error.code = 'PAYMENT_FOLLOWUP_LIMIT';
    throw error;
  }

  if (state.count >= 1 && state.lastFollowupAt) {
    const nextAtMs = new Date(state.lastFollowupAt).getTime() + AFFILIATE_FOLLOWUP_COOLDOWN_MS;
    if (Number.isFinite(nextAtMs) && nextAtMs > Date.now()) {
      const error = new Error(`Follow-up kedua boleh dihantar selepas ${new Date(nextAtMs).toISOString()}.`);
      error.code = 'PAYMENT_FOLLOWUP_COOLDOWN';
      error.retryAt = new Date(nextAtMs).toISOString();
      throw error;
    }
  }
  return state;
}

async function recordAffiliateFollowupSent(orderNumber, affiliateUserId) {
  await ensurePaymentFollowupSchema();
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO support_affiliate_followups (
            environment, order_number, affiliate_user_id,
            followup_count, last_followup_at, created_at, updated_at
          ) VALUES (?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(environment, order_number, affiliate_user_id) DO UPDATE SET
            followup_count = support_affiliate_followups.followup_count + 1,
            last_followup_at = excluded.last_followup_at,
            updated_at = excluded.updated_at`,
    args: [env, String(orderNumber || ''), String(affiliateUserId || ''), now, now, now],
  });
}

export async function sendPaymentFollowup(orderNumber, {
  manual = false,
  actorRole = 'owner',
  actorUserId = '',
} = {}) {
  await ensureFollowupRow(orderNumber);
  let row = await orderContext(orderNumber);
  if (!row) {
    const error = new Error('Payment order tidak dijumpai.');
    error.code = 'PAYMENT_ORDER_NOT_FOUND';
    throw error;
  }

  const state = String(row.followup_state || 'ACTIVE').toUpperCase();
  const affiliateActor = manual && String(actorRole || '').toLowerCase() === 'affiliate';
  if (affiliateActor) {
    if (state === 'REVIEW') {
      const error = new Error('Payment ini sedang dalam review. Follow-up dihentikan sementara.');
      error.code = 'PAYMENT_FOLLOWUP_REVIEW';
      throw error;
    }
    await affiliateFollowupGate(row, actorUserId);
  }
  if (!manual && ['STOPPED','REVIEW','RESOLVED'].includes(state)) {
    return { sent: false, reason: state.toLowerCase(), followup: await getPaymentFollowupInfo(orderNumber) };
  }

  const currentStatus = String(row.status || '').toUpperCase();
  const manualUnsuccessfulFollowup = manual && [
    'FAILED',
    'CANCELLED',
    'CANCELLED_BY_USER',
    'EXPIRED',
    'INTENT_FAILED',
    'AMOUNT_MISMATCH',
  ].includes(currentStatus);
  const checked = manualUnsuccessfulFollowup
    ? {
        paid: false,
        resolved: false,
        orderStatus: currentStatus,
        stage: classifyPaymentStage({
          orderStatus: row.status,
          gatewayTransactionId: row.gateway_transaction_id,
          gatewayStatus: row.last_gateway_status,
          followupState: row.followup_state,
        }),
        manualUnsuccessfulFollowup: true,
      }
    : await reconcilePaymentFollowup(orderNumber);
  // A failed/unavailable gateway lookup is not evidence of an abandoned payment.
  if (!manual && checked.lookupFailed) return {sent:false,reason:'payment_status_unverified'};
  if (checked.resolved || checked.paid) {
    return { sent: false, reason: checked.orderStatus || 'resolved', reconciliation: checked, followup: await getPaymentFollowupInfo(orderNumber) };
  }

  row = await orderContext(orderNumber);
  if (!row?.telegram_user_id) {
    return { sent: false, reason: 'missing_user', followup: await getPaymentFollowupInfo(orderNumber) };
  }
  if (!manual && !row?.payment_url) {
    return { sent: false, reason: 'missing_payment_url', followup: await getPaymentFollowupInfo(orderNumber) };
  }

  let sent;
  try {
    const recipient = await followupRecipient(row);
    sent = await sendMessage(row.telegram_user_id, followupText(row, recipient), {
      reply_markup: await followupKeyboard(row),
    });
  } catch (error) {
    const delivery = telegramDeliveryError(error);
    await recordFollowupFailure(orderNumber, delivery).catch((recordError) => {
      console.warn('[payment-followup] delivery failure record failed:', recordError?.message);
    });
    const friendly = new Error(delivery.message);
    friendly.code = delivery.code;
    friendly.status = error?.status;
    throw friendly;
  }
  const keepPassiveAfterManual = manual && (
    ['STOPPED','RESOLVED'].includes(String(row.followup_state || '').toUpperCase())
    || ['CANCELLED','CANCELLED_BY_USER'].includes(String(row.status || '').toUpperCase())
  );
  await recordFollowupSent(orderNumber, sent?.message_id || '', {
    reactivate: !keepPassiveAfterManual,
  });
  if (affiliateActor) {
    await recordAffiliateFollowupSent(orderNumber, actorUserId);
  }
  return {
    sent: true,
    messageId: sent?.message_id || null,
    reconciliation: checked,
    followup: await getPaymentFollowupInfo(orderNumber, {
      viewerRole: affiliateActor ? 'affiliate' : 'owner',
      viewerUserId: affiliateActor ? actorUserId : '',
    }),
  };
}

export async function stopPaymentFollowupForAmountSelection(messageId, userId) {
  const id = String(messageId || '').trim();
  const uid = String(userId || '').trim();
  if (!id || !uid) return null;

  await ensurePaymentFollowupSchema();
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT f.order_number
          FROM support_payment_followups f
          JOIN support_orders o
            ON o.environment = f.environment
           AND o.order_number = f.order_number
          WHERE f.environment = ?
            AND f.last_message_id = ?
            AND o.telegram_user_id = ?
          ORDER BY f.updated_at DESC
          LIMIT 1`,
    args: [env, id, uid],
  });
  const orderNumber = String(result.rows?.[0]?.order_number || '');
  if (!orderNumber) return null;

  await markFollowupState(orderNumber, 'STOPPED', 'AMOUNT_RESELECTED');
  return orderNumber;
}

export async function stopPaymentFollowup(orderNumber, reason = 'OWNER_STOPPED') {
  const row = await orderContext(orderNumber);
  if (!row) {
    const error = new Error('Payment order tidak dijumpai.');
    error.code = 'PAYMENT_ORDER_NOT_FOUND';
    throw error;
  }
  await markFollowupState(orderNumber, 'STOPPED', reason);
  return getPaymentFollowupInfo(orderNumber);
}

async function notifyOwnerReview(row) {
  const ownerId = String(process.env.BOT_OWNER_ID || '').trim();
  if (!/^\d+$/.test(ownerId)) return;
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const detailUrl = base
    ? `${base}/ar-payment/transaction?order=${encodeURIComponent(String(row.order_number || ''))}`
    : '';
  const who = row.telegram_username ? `@${row.telegram_username}` : `ID ${row.telegram_user_id}`;
  await sendMessage(ownerId, [
    '🔎 PAYPING PAYMENT REVIEW',
    '',
    `User: ${who}`,
    `Amount: RM${money(row.amount_cents)}`,
    `Support ID: ${row.order_number}`,
    '',
    'User tekan “Dah Bayar / Semak” tetapi Bayarcash belum confirm paid.',
    'Semak transaksi ini dalam PayPing sebelum minta user bayar sekali lagi.',
  ].join('\n'), detailUrl ? {
    reply_markup: { inline_keyboard: [[{ text: 'Open PayPing Transaction', url: detailUrl }]] },
  } : {}).catch((error) => {
    console.warn('[payment-followup] owner review notification failed:', error?.message);
  });
}

export async function markPaymentReview(orderNumber, userId) {
  const row = await orderContext(orderNumber);
  if (!row || String(row.telegram_user_id || '') !== String(userId || '')) {
    const error = new Error('Payment follow-up tidak sah untuk user ini.');
    error.code = 'PAYMENT_FOLLOWUP_FORBIDDEN';
    throw error;
  }

  const checked = await reconcilePaymentFollowup(orderNumber);
  if (checked.paid || checked.resolved) {
    return { review: false, resolved: true, reconciliation: checked, followup: await getPaymentFollowupInfo(orderNumber) };
  }

  await markFollowupState(orderNumber, 'REVIEW', 'USER_REPORTED_PAID');
  const fresh = await orderContext(orderNumber);
  await notifyOwnerReview(fresh || row);
  return { review: true, resolved: false, reconciliation: checked, followup: await getPaymentFollowupInfo(orderNumber) };
}

export async function cancelPaymentFollowupByUser(orderNumber, userId) {
  const row = await orderContext(orderNumber);
  if (!row || String(row.telegram_user_id || '') !== String(userId || '')) {
    const error = new Error('Payment follow-up tidak sah untuk user ini.');
    error.code = 'PAYMENT_FOLLOWUP_FORBIDDEN';
    throw error;
  }

  await cancelSupportSubmission(orderNumber, userId).catch(() => null);
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE support_orders
          SET status = 'CANCELLED_BY_USER', status_description = 'User cancelled checkout follow-up', updated_at = ?
          WHERE environment = ? AND order_number = ? AND paid_at IS NULL
            AND status NOT IN ('PAID','FAILED','CANCELLED','EXPIRED')`,
    args: [now, env, String(orderNumber || '')],
  });
  await markFollowupState(orderNumber, 'STOPPED', 'USER_CANCELLED');
  return getPaymentFollowupInfo(orderNumber);
}

export async function getPaymentFollowupInfo(orderNumber, {
  viewerRole = 'owner',
  viewerUserId = '',
} = {}) {
  await ensureFollowupRow(orderNumber);
  const row = await orderContext(orderNumber);
  if (!row) return null;
  const ownerCount = Number(row.followup_count || 0);
  const state = String(row.followup_state || 'ACTIVE').toUpperCase();
  const ownerLast = row.last_followup_at ? String(row.last_followup_at) : null;
  // Owner follow-up is manual-only. Never expose or calculate an automatic reminder time.
  const ownerNext = null;

  const affiliateViewer = String(viewerRole || '').toLowerCase() === 'affiliate';
  const affiliateState = affiliateViewer
    ? await affiliateFollowupState(orderNumber, viewerUserId)
    : { count: 0, lastFollowupAt: null };
  let affiliateNext = null;
  if (affiliateViewer && affiliateState.count === 1 && affiliateState.lastFollowupAt) {
    const nextMs = new Date(affiliateState.lastFollowupAt).getTime() + AFFILIATE_FOLLOWUP_COOLDOWN_MS;
    if (Number.isFinite(nextMs)) affiliateNext = new Date(nextMs).toISOString();
  }
  const affiliateOwnsReferral = !affiliateViewer
    || String(row.referrer_user_id || '') === String(viewerUserId || '');
  const affiliateReady = !affiliateNext || new Date(affiliateNext).getTime() <= Date.now();
  const baseCanFollowUp = String(row.status || '').toUpperCase() !== 'PAID' && state !== 'REVIEW';

  return {
    state,
    stage: classifyPaymentStage({
      orderStatus: row.status,
      gatewayTransactionId: row.gateway_transaction_id,
      gatewayStatus: row.last_gateway_status,
      followupState: state,
    }),
    followupCount: affiliateViewer ? affiliateState.count : ownerCount,
    maxFollowups: affiliateViewer ? AFFILIATE_MAX_FOLLOWUPS : MAX_FOLLOWUPS,
    lastFollowupAt: affiliateViewer ? affiliateState.lastFollowupAt : ownerLast,
    nextFollowupAt: affiliateViewer ? affiliateNext : ownerNext,
    cooldownHours: affiliateViewer ? 8 : null,
    reviewAt: row.review_at ? String(row.review_at) : null,
    stoppedAt: row.stopped_at ? String(row.stopped_at) : null,
    stoppedReason: String(row.stopped_reason || ''),
    lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : null,
    telegramDeliveryStatus: String(row.last_delivery_status || ''),
    telegramErrorCode: String(row.last_error_code || ''),
    telegramError: String(row.last_error || ''),
    canFollowUp: baseCanFollowUp
      && (!affiliateViewer || (
        affiliateOwnsReferral
        && affiliateState.count < AFFILIATE_MAX_FOLLOWUPS
        && affiliateReady
      )),
    affiliateOwnsReferral,
    paymentUrlAvailable: Boolean(row.payment_url),
  };
}

// Set a persistent activation watermark. Old pending orders are deliberately
// excluded: enabling this feature must never send a backlog of historic DMs.
export async function autoFollowupRollout(){
  await ensurePaymentFollowupSchema();
  const db=await getSupportDb(),env=currentSupportEnvironment();
  const t=new Date().toISOString();
  await db.execute({sql:"INSERT OR IGNORE INTO support_auto_followup_rollout_v3(environment,enabled,activated_at,updated_at) VALUES(?,1,?,?)",args:[env,t,t]});
  const r=await db.execute({sql:"SELECT enabled,activated_at FROM support_auto_followup_rollout_v3 WHERE environment=? LIMIT 1",args:[env]});
  return {enabled:Number(r.rows?.[0]?.enabled||0)===1,activatedAt:String(r.rows?.[0]?.activated_at||t)};
}

async function dueOrders(limit=20){
  const mode=await autoFollowupRollout();
  if(!mode.enabled)return [];
  await ensureSubmissionSchema();
  const db=await getSupportDb(),env=currentSupportEnvironment();
  const cutoff=new Date(Date.now()-FIRST_FOLLOWUP_MS).toISOString();
  const secondCutoff=new Date(Date.now()-SECOND_FOLLOWUP_MS).toISOString();
  const r=await db.execute({sql:`SELECT o.order_number,COALESCE(f.followup_count,0) AS followup_count
    FROM support_orders o JOIN support_submissions s ON s.environment=o.environment AND s.order_number=o.order_number
    LEFT JOIN support_payment_followups f ON f.environment=o.environment AND f.order_number=o.order_number
    WHERE o.environment=? AND o.created_at>=? AND o.created_at<=?
      AND o.status='PENDING' AND o.paid_at IS NULL
      AND s.state='CHECKOUT' AND s.payment_url LIKE 'https://%'
      AND COALESCE(s.checkout_open_count,0)>0
      AND s.checkout_first_opened_at IS NOT NULL
      AND s.checkout_first_opened_at<=?
      AND COALESCE(f.state,'ACTIVE')='ACTIVE'
      AND COALESCE(f.followup_count,0)<2
      AND (COALESCE(f.followup_count,0)=0 OR f.last_followup_at<=?)
    ORDER BY o.created_at ASC LIMIT ?`,args:[env,mode.activatedAt,cutoff,cutoff,secondCutoff,Math.max(1,Math.min(Number(limit)||20,100))]});
  return (r.rows||[]).map(x=>({order:String(x.order_number),sequence:Number(x.followup_count||0)+1}));
}
async function claimAutoFollowup(order,sequence){
 const db=await getSupportDb();
 const t=new Date().toISOString();
 const result=await db.execute({sql:"INSERT OR IGNORE INTO support_auto_followup_claims_v3(environment,order_number,sequence_no,claimed_at,state) VALUES(?,?,?,?,'sending')",args:[currentSupportEnvironment(),order,sequence,t]});
 return Number(result.rowsAffected||0)===1;
}
async function finishAutoClaim(order,sequence,status){
 const db=await getSupportDb();
 await db.execute({sql:"UPDATE support_auto_followup_claims_v3 SET state=? WHERE environment=? AND order_number=? AND sequence_no=?",args:[status,currentSupportEnvironment(),order,sequence]});
}
export async function runPaymentFollowupCycle(){
 if(cycleRunning)return {skipped:true,reason:'already_running'};
 cycleRunning=true;
 const result={skipped:false,candidates:0,sent:0,resolved:0,failed:0};
 try{
   const candidates=await dueOrders(20);
   result.candidates=candidates.length;
   for(const {order,sequence} of candidates){
     if(!await claimAutoFollowup(order,sequence))continue;
     let state='needs_review';
     try{
       const outcome=await sendPaymentFollowup(order,{manual:false});
       if(outcome.sent){result.sent++;state='sent'}
       else{state='skipped';result.resolved++}
     }catch(e){result.failed++;console.warn('[payment-followup] automatic delivery requires review:',e.code||e.message)}
     finally{await finishAutoClaim(order,sequence,state).catch(e=>console.warn('[payment-followup] claim update failed:',e.message))}
   }
   return result;
 }finally{cycleRunning=false}
}
export function startPaymentFollowupScheduler(){
 if(schedulerTimer)return schedulerTimer;
 const run=()=>void runPaymentFollowupCycle().catch(e=>console.warn('[payment-followup] auto cycle failed:',e.message));
 // Activation is persisted *before* the first scheduled check.
 void autoFollowupRollout().then(x=>{
   console.log('[payment-followup] automatic future checkouts only',x);
   if(!schedulerTimer){
     schedulerTimer=setInterval(run,CHECK_INTERVAL_MS);
     schedulerTimer.unref?.();
     setTimeout(run,15_000).unref?.();
   }
 }).catch(e=>console.warn('[payment-followup] auto schedule initialization failed:',e.message));
 return schedulerTimer;
}
