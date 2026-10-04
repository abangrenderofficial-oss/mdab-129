import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { currentSupportEnvironment, getSupportDb } from '../support/store.js';
import {
  affiliateCommissionPercent,
  affiliateHoldDays,
  affiliateMinimumWithdrawalCents,
} from './config.js';

function validUserId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : '';
}

function cleanUsername(value) {
  return String(value || '').replace(/^@+/, '').trim().slice(0, 64);
}

function money(value) {
  return (Math.max(0, Number(value || 0)) / 100).toFixed(2);
}

let payoutSchemaPromise = null;

function payoutKey() {
  const secret = String(
    process.env.AFFILIATE_PAYOUT_ENCRYPTION_KEY
    || process.env.SETUP_SECRET
    || ''
  ).trim();
  if (!secret) {
    const error = new Error('Affiliate payout encryption belum configured.');
    error.code = 'PAYOUT_ENCRYPTION_NOT_CONFIGURED';
    throw error;
  }
  return createHash('sha256')
    .update(`payping-affiliate-payout-v1:${secret}`)
    .digest();
}

function encryptPayoutDetails(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', payoutKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value || {}), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

function decryptPayoutDetails(payload) {
  const parts = String(payload || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      payoutKey(),
      Buffer.from(parts[1], 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    const clear = Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(clear.toString('utf8'));
  } catch {
    return null;
  }
}

function cleanPayoutText(value, max = 120) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function payoutDisplayHint(method, details = {}) {
  const tail = (value) => {
    const text = String(value || '').replace(/\s+/g, '');
    return text ? `••••${text.slice(-4)}` : '-';
  };
  if (method === 'DUITNOW') {
    return `DuitNow ${cleanPayoutText(details.identifierType, 24)} · ${tail(details.identifier)}`;
  }
  return `${cleanPayoutText(details.bankName, 50) || 'Bank'} · ${tail(details.accountNumber)}`;
}

async function ensureAffiliatePayoutSchema(db) {
  if (!payoutSchemaPromise) {
    payoutSchemaPromise = db.execute(`
      CREATE TABLE IF NOT EXISTS affiliate_payout_profiles (
        environment TEXT NOT NULL,
        telegram_user_id TEXT NOT NULL,
        method TEXT NOT NULL,
        display_hint TEXT NOT NULL,
        details_ciphertext TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (environment, telegram_user_id)
      )
    `).catch((error) => {
      payoutSchemaPromise = null;
      throw error;
    });
  }
  await payoutSchemaPromise;
}

function normalizePayoutInput(input = {}) {
  const method = cleanPayoutText(input.method, 16).toUpperCase();
  if (method === 'DUITNOW') {
    const identifierType = cleanPayoutText(input.identifierType, 24).toUpperCase();
    const identifier = cleanPayoutText(input.identifier, 80);
    const accountName = cleanPayoutText(input.accountName, 100);
    if (!['PHONE', 'NRIC', 'BUSINESS'].includes(identifierType) || !identifier || !accountName) {
      const error = new Error('Maklumat DuitNow tidak lengkap.');
      error.code = 'INVALID_PAYOUT_PROFILE';
      throw error;
    }
    return { method, details: { identifierType, identifier, accountName } };
  }

  if (method === 'BANK') {
    const bankName = cleanPayoutText(input.bankName, 80);
    const accountName = cleanPayoutText(input.accountName, 100);
    const accountNumber = cleanPayoutText(input.accountNumber, 80).replace(/\s+/g, '');
    if (!bankName || !accountName || !accountNumber) {
      const error = new Error('Maklumat bank tidak lengkap.');
      error.code = 'INVALID_PAYOUT_PROFILE';
      throw error;
    }
    return { method, details: { bankName, accountName, accountNumber } };
  }

  const error = new Error('Payout method tidak sah.');
  error.code = 'INVALID_PAYOUT_PROFILE';
  throw error;
}

function normalizeReferralCode(value) {
  return String(value || '')
    .trim()
    .replace(/^ref[_-]?/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 24);
}

function randomReferralCode() {
  return randomBytes(5).toString('hex').toUpperCase();
}

function rowToProfile(row) {
  if (!row) return null;
  return {
    userId: String(row.telegram_user_id || ''),
    username: String(row.telegram_username || ''),
    referralCode: String(row.referral_code || ''),
    referredByUserId: row.referred_by_user_id ? String(row.referred_by_user_id) : null,
    referredAt: row.referred_at ? String(row.referred_at) : null,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

async function profileByUser(db, environment, userId) {
  const result = await db.execute({
    sql: `SELECT telegram_user_id, telegram_username, referral_code,
                 referred_by_user_id, referred_at, created_at, updated_at
          FROM affiliate_profiles
          WHERE environment = ? AND telegram_user_id = ?
          LIMIT 1`,
    args: [environment, userId],
  });
  return rowToProfile(result.rows?.[0] || null);
}

async function profileByCode(db, environment, referralCode) {
  const result = await db.execute({
    sql: `SELECT telegram_user_id, telegram_username, referral_code,
                 referred_by_user_id, referred_at, created_at, updated_at
          FROM affiliate_profiles
          WHERE environment = ? AND referral_code = ?
          LIMIT 1`,
    args: [environment, referralCode],
  });
  return rowToProfile(result.rows?.[0] || null);
}

export async function ensureAffiliateProfile({ userId, username = '' } = {}) {
  const key = validUserId(userId);
  if (!key) throw new Error('Invalid affiliate user.');

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const existing = await profileByUser(db, environment, key);
  const normalizedUsername = cleanUsername(username);

  if (existing) {
    if (normalizedUsername && normalizedUsername !== existing.username) {
      await db.execute({
        sql: `UPDATE affiliate_profiles
              SET telegram_username = ?, updated_at = ?
              WHERE environment = ? AND telegram_user_id = ?`,
        args: [normalizedUsername, new Date().toISOString(), environment, key],
      });
      return profileByUser(db, environment, key);
    }
    return existing;
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const now = new Date().toISOString();
    const code = randomReferralCode();
    try {
      await db.execute({
        sql: `INSERT INTO affiliate_profiles (
                environment, telegram_user_id, telegram_username, referral_code,
                referred_by_user_id, referred_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
        args: [environment, key, normalizedUsername, code, now, now],
      });
      return profileByUser(db, environment, key);
    } catch (error) {
      const raced = await profileByUser(db, environment, key);
      if (raced) return raced;
      if (!String(error?.message || '').toLowerCase().includes('unique')) throw error;
    }
  }

  throw new Error('Unable to generate unique affiliate referral code.');
}

export async function lockAffiliateReferral({ userId, username = '', referralCode = '' } = {}) {
  const key = validUserId(userId);
  const code = normalizeReferralCode(referralCode);
  if (!key || !code) return { applied: false, reason: 'invalid_referral' };

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const userProfile = await ensureAffiliateProfile({ userId: key, username });
  const referrer = await profileByCode(db, environment, code);

  if (!referrer) return { applied: false, reason: 'referrer_not_found', profile: userProfile };
  if (referrer.userId === key) return { applied: false, reason: 'self_referral', profile: userProfile };

  if (userProfile.referredByUserId) {
    return {
      applied: false,
      reason: userProfile.referredByUserId === referrer.userId ? 'already_linked' : 'referrer_locked',
      profile: userProfile,
      referrer,
    };
  }

  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `UPDATE affiliate_profiles
          SET referred_by_user_id = ?, referred_at = ?, updated_at = ?
          WHERE environment = ? AND telegram_user_id = ?
            AND referred_by_user_id IS NULL`,
    args: [referrer.userId, now, now, environment, key],
  });

  return {
    applied: Number(result.rowsAffected || 0) === 1,
    reason: Number(result.rowsAffected || 0) === 1 ? 'linked' : 'referrer_locked',
    profile: await profileByUser(db, environment, key),
    referrer,
  };
}

async function releaseMaturedCommissions(executor, environment, now) {
  await executor.execute({
    sql: `UPDATE affiliate_commissions
          SET status = 'AVAILABLE', updated_at = ?
          WHERE environment = ? AND status = 'PENDING' AND available_at <= ?`,
    args: [now, environment, now],
  });
}

export async function getAffiliateDashboard({ userId, username = '' } = {}) {
  const profile = await ensureAffiliateProfile({ userId, username });
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await releaseMaturedCommissions(db, environment, now);

  const counts = await db.execute({
    sql: `SELECT
            COUNT(*) AS referrals,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM affiliate_commissions c
              WHERE c.environment = p.environment
                AND c.referred_user_id = p.telegram_user_id
            ) THEN 1 ELSE 0 END) AS paying_referrals
          FROM affiliate_profiles p
          WHERE p.environment = ? AND p.referred_by_user_id = ?`,
    args: [environment, profile.userId],
  });

  const sums = await db.execute({
    sql: `SELECT
            COALESCE(SUM(CASE WHEN status = 'PENDING' THEN commission_cents ELSE 0 END), 0) AS pending_cents,
            COALESCE(SUM(CASE WHEN status = 'AVAILABLE' THEN commission_cents ELSE 0 END), 0) AS available_cents,
            COALESCE(SUM(CASE WHEN status = 'WITHDRAWAL_PENDING' THEN commission_cents ELSE 0 END), 0) AS withdrawing_cents,
            COALESCE(SUM(CASE WHEN status = 'PAID' THEN commission_cents ELSE 0 END), 0) AS paid_cents,
            COALESCE(SUM(commission_cents), 0) AS total_cents
          FROM affiliate_commissions
          WHERE environment = ? AND referrer_user_id = ?`,
    args: [environment, profile.userId],
  });

  const countRow = counts.rows?.[0] || {};
  const sumRow = sums.rows?.[0] || {};
  return {
    profile,
    referrals: Number(countRow.referrals || 0),
    payingReferrals: Number(countRow.paying_referrals || 0),
    pending: money(sumRow.pending_cents),
    available: money(sumRow.available_cents),
    withdrawing: money(sumRow.withdrawing_cents),
    paid: money(sumRow.paid_cents),
    totalEarned: money(sumRow.total_cents),
    commissionPercent: affiliateCommissionPercent(),
    holdDays: affiliateHoldDays(),
    minimumWithdrawal: money(affiliateMinimumWithdrawalCents()),
  };
}

export async function createAffiliateWithdrawal({ userId, username = '' } = {}) {
  const profile = await ensureAffiliateProfile({ userId, username });
  const payoutProfile = await getAffiliatePayoutProfile({ userId: profile.userId });
  if (!payoutProfile?.configured || payoutProfile?.readable === false) {
    return {
      created: false,
      reason: 'payout_profile_required',
    };
  }

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const tx = await db.transaction('write');

  try {
    const now = new Date().toISOString();
    await releaseMaturedCommissions(tx, environment, now);

    const availableResult = await tx.execute({
      sql: `SELECT COALESCE(SUM(commission_cents), 0) AS amount_cents
            FROM affiliate_commissions
            WHERE environment = ? AND referrer_user_id = ? AND status = 'AVAILABLE'`,
      args: [environment, profile.userId],
    });
    const amountCents = Number(availableResult.rows?.[0]?.amount_cents || 0);
    const minimumCents = affiliateMinimumWithdrawalCents();

    if (amountCents < minimumCents) {
      await tx.commit();
      return {
        created: false,
        reason: 'below_minimum',
        available: money(amountCents),
        minimum: money(minimumCents),
      };
    }

    const requestId = `AW-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    await tx.execute({
      sql: `INSERT INTO affiliate_withdrawals (
              environment, request_id, telegram_user_id, amount_cents,
              status, created_at, updated_at, paid_at
            ) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, NULL)`,
      args: [environment, requestId, profile.userId, amountCents, now, now],
    });

    const claimed = await tx.execute({
      sql: `UPDATE affiliate_commissions
            SET status = 'WITHDRAWAL_PENDING', payout_request_id = ?, updated_at = ?
            WHERE environment = ? AND referrer_user_id = ? AND status = 'AVAILABLE'`,
      args: [requestId, now, environment, profile.userId],
    });

    if (Number(claimed.rowsAffected || 0) < 1) {
      throw new Error('No affiliate commissions were claimed for withdrawal.');
    }

    await tx.commit();
    return {
      created: true,
      requestId,
      userId: profile.userId,
      username: profile.username,
      amount: money(amountCents),
      status: 'PENDING',
    };
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
}

export async function getAffiliateActivity({ userId, username = '', limit = 30 } = {}) {
  const profile = await ensureAffiliateProfile({ userId, username });
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await releaseMaturedCommissions(db, environment, now);

  const safeLimit = Math.max(1, Math.min(100, Number(limit || 30)));

  const [commissionResult, withdrawalResult] = await Promise.all([
    db.execute({
      sql: `SELECT commission_id, order_number, gross_cents, rate_bps,
                   commission_cents, status, available_at, payout_request_id,
                   created_at, updated_at
            FROM affiliate_commissions
            WHERE environment = ? AND referrer_user_id = ?
            ORDER BY created_at DESC
            LIMIT ?`,
      args: [environment, profile.userId, safeLimit],
    }),
    db.execute({
      sql: `SELECT request_id, amount_cents, status, created_at, updated_at, paid_at
            FROM affiliate_withdrawals
            WHERE environment = ? AND telegram_user_id = ?
            ORDER BY created_at DESC
            LIMIT ?`,
      args: [environment, profile.userId, safeLimit],
    }),
  ]);

  return {
    commissions: (commissionResult.rows || []).map((row) => ({
      commissionId: String(row.commission_id || ''),
      orderNumber: String(row.order_number || ''),
      grossAmount: money(row.gross_cents),
      commissionAmount: money(row.commission_cents),
      ratePercent: (Number(row.rate_bps || 0) / 100).toFixed(2).replace(/\.00$/, ''),
      status: String(row.status || ''),
      availableAt: row.available_at ? String(row.available_at) : null,
      payoutRequestId: row.payout_request_id ? String(row.payout_request_id) : null,
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
    })),
    withdrawals: (withdrawalResult.rows || []).map((row) => ({
      requestId: String(row.request_id || ''),
      amount: money(row.amount_cents),
      status: String(row.status || ''),
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
      paidAt: row.paid_at ? String(row.paid_at) : null,
    })),
  };
}

export async function getAffiliatePayoutProfile({ userId } = {}) {
  const key = validUserId(userId);
  if (!key) throw new Error('Invalid affiliate user.');

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  await ensureAffiliatePayoutSchema(db);

  const result = await db.execute({
    sql: `SELECT method, display_hint, details_ciphertext, created_at, updated_at
          FROM affiliate_payout_profiles
          WHERE environment = ? AND telegram_user_id = ?
          LIMIT 1`,
    args: [environment, key],
  });
  const row = result.rows?.[0];
  if (!row) return { configured: false };

  const details = decryptPayoutDetails(row.details_ciphertext);
  if (!details) {
    return {
      configured: true,
      readable: false,
      method: String(row.method || ''),
      displayHint: String(row.display_hint || ''),
    };
  }

  return {
    configured: true,
    readable: true,
    method: String(row.method || ''),
    displayHint: String(row.display_hint || ''),
    details,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

export async function saveAffiliatePayoutProfile({ userId, payout = {} } = {}) {
  const key = validUserId(userId);
  if (!key) throw new Error('Invalid affiliate user.');

  const normalized = normalizePayoutInput(payout);
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  await ensureAffiliatePayoutSchema(db);

  const now = new Date().toISOString();
  const ciphertext = encryptPayoutDetails(normalized.details);
  const displayHint = payoutDisplayHint(normalized.method, normalized.details);

  await db.execute({
    sql: `INSERT INTO affiliate_payout_profiles (
            environment, telegram_user_id, method, display_hint,
            details_ciphertext, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(environment, telegram_user_id) DO UPDATE SET
            method = excluded.method,
            display_hint = excluded.display_hint,
            details_ciphertext = excluded.details_ciphertext,
            updated_at = excluded.updated_at`,
    args: [environment, key, normalized.method, displayHint, ciphertext, now, now],
  });

  return getAffiliatePayoutProfile({ userId: key });
}


function affiliateEmailName(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.includes('@') ? email.split('@')[0].trim().slice(0, 80) : email.slice(0, 80);
}

function affiliateAdminLabel(username, email, userId) {
  const handle = cleanUsername(username);
  if (handle) return '@' + handle;
  const local = affiliateEmailName(email);
  return local || ('ID ' + String(userId || ''));
}

const TRUE_AFFILIATE_FILTER = String.raw`
  (
    COALESCE(a.role, '') = 'affiliate'
    OR EXISTS (
      SELECT 1 FROM affiliate_profiles child
      WHERE child.environment = p.environment
        AND child.referred_by_user_id = p.telegram_user_id
    )
    OR EXISTS (
      SELECT 1 FROM affiliate_commissions ac
      WHERE ac.environment = p.environment
        AND ac.referrer_user_id = p.telegram_user_id
    )
  )
`;

async function auditAffiliateWithdrawalWithExecutor(executor, environment, requestId) {
  const id = String(requestId || '').trim().toUpperCase();
  if (!id) return { exists: false, verified: false, reason: 'missing_request' };

  const withdrawalResult = await executor.execute({
    sql: `SELECT request_id, telegram_user_id, amount_cents, status, created_at, updated_at, paid_at
          FROM affiliate_withdrawals
          WHERE environment = ? AND request_id = ?
          LIMIT 1`,
    args: [environment, id],
  });
  const withdrawal = withdrawalResult.rows?.[0];
  if (!withdrawal) return { exists: false, verified: false, reason: 'not_found', requestId: id };

  const userId = String(withdrawal.telegram_user_id || '');
  const withdrawalStatus = String(withdrawal.status || '').toUpperCase();
  const expectedCommissionStatus = withdrawalStatus === 'PAID' ? 'PAID' : 'WITHDRAWAL_PENDING';

  const commissionResult = await executor.execute({
    sql: `SELECT c.commission_id, c.order_number, c.referrer_user_id, c.referred_user_id,
                 c.gross_cents, c.rate_bps, c.commission_cents, c.status,
                 c.available_at, c.payout_request_id, c.created_at,
                 COALESCE(o.amount_cents, 0) AS order_amount_cents,
                 COALESCE(o.status, '') AS order_status,
                 COALESCE(o.paid_at, '') AS order_paid_at,
                 COALESCE(o.telegram_username, '') AS buyer_username,
                 COALESCE(b.referred_by_user_id, '') AS buyer_referrer_user_id
          FROM affiliate_commissions c
          LEFT JOIN support_orders o
            ON o.environment = c.environment
           AND o.order_number = c.order_number
          LEFT JOIN affiliate_profiles b
            ON b.environment = c.environment
           AND b.telegram_user_id = c.referred_user_id
          WHERE c.environment = ?
            AND c.payout_request_id = ?
          ORDER BY c.created_at ASC`,
    args: [environment, id],
  });

  let calculatedCents = 0;
  let invalidCount = 0;
  const lines = (commissionResult.rows || []).map((row) => {
    const grossCents = Number(row.gross_cents || 0);
    const rateBps = Number(row.rate_bps || 0);
    const commissionCents = Number(row.commission_cents || 0);
    const orderAmountCents = Number(row.order_amount_cents || 0);
    const expectedCommissionCents = Math.round((grossCents * rateBps) / 10000);
    const checks = {
      referrer: String(row.referrer_user_id || '') === userId,
      referralOwner: String(row.buyer_referrer_user_id || '') === userId,
      paidOrder: String(row.order_status || '').toUpperCase() === 'PAID' && Boolean(row.order_paid_at),
      grossMatchesOrder: grossCents > 0 && grossCents === orderAmountCents,
      commissionMath: commissionCents > 0 && commissionCents === expectedCommissionCents,
      commissionStatus: String(row.status || '').toUpperCase() === expectedCommissionStatus,
      payoutRequest: String(row.payout_request_id || '').toUpperCase() === id,
    };
    const valid = Object.values(checks).every(Boolean);
    if (!valid) invalidCount += 1;
    calculatedCents += commissionCents;
    return {
      commissionId: String(row.commission_id || ''),
      orderNumber: String(row.order_number || ''),
      referredUserId: String(row.referred_user_id || ''),
      buyerUsername: String(row.buyer_username || ''),
      grossAmount: money(grossCents),
      ratePercent: (rateBps / 100).toFixed(2).replace(/\.00$/, ''),
      commissionAmount: money(commissionCents),
      status: String(row.status || ''),
      orderStatus: String(row.order_status || ''),
      createdAt: String(row.created_at || ''),
      valid,
      checks,
    };
  });

  const requestedCents = Number(withdrawal.amount_cents || 0);
  const statusAuditable = ['PENDING','PAID'].includes(withdrawalStatus);
  const verified = statusAuditable
    && lines.length > 0
    && invalidCount === 0
    && requestedCents > 0
    && requestedCents === calculatedCents;

  return {
    exists: true,
    verified,
    reason: verified ? 'verified' : (withdrawalStatus === 'REJECTED' ? 'rejected' : 'mismatch'),
    requestId: id,
    userId,
    status: withdrawalStatus,
    requestedAmount: money(requestedCents),
    calculatedAmount: money(calculatedCents),
    differenceAmount: money(Math.abs(requestedCents - calculatedCents)),
    paymentCount: lines.length,
    invalidCount,
    createdAt: String(withdrawal.created_at || ''),
    paidAt: withdrawal.paid_at ? String(withdrawal.paid_at) : null,
    canMarkPaid: verified && withdrawalStatus === 'PENDING',
    lines,
  };
}

export async function getAffiliateAdminDashboard({ limit = 100 } = {}) {
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await releaseMaturedCommissions(db, environment, now);
  await ensureAffiliatePayoutSchema(db);

  const safeLimit = Math.max(1, Math.min(200, Number(limit || 100)));

  const [profileStats, commissionStats, withdrawalStats, withdrawals, affiliates] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) AS affiliates
            FROM affiliate_profiles p
            LEFT JOIN payping_accounts a
              ON a.telegram_user_id = p.telegram_user_id
             AND a.status = 'active'
            WHERE p.environment = ?
              AND ${TRUE_AFFILIATE_FILTER}`,
      args: [environment],
    }),
    db.execute({
      sql: `SELECT
              COUNT(*) AS commission_count,
              COALESCE(SUM(commission_cents), 0) AS total_cents,
              COALESCE(SUM(CASE WHEN status = 'PENDING' THEN commission_cents ELSE 0 END), 0) AS pending_cents,
              COALESCE(SUM(CASE WHEN status = 'AVAILABLE' THEN commission_cents ELSE 0 END), 0) AS available_cents,
              COALESCE(SUM(CASE WHEN status = 'WITHDRAWAL_PENDING' THEN commission_cents ELSE 0 END), 0) AS withdrawing_cents,
              COALESCE(SUM(CASE WHEN status = 'PAID' THEN commission_cents ELSE 0 END), 0) AS paid_cents
            FROM affiliate_commissions
            WHERE environment = ?`,
      args: [environment],
    }),
    db.execute({
      sql: `SELECT
              COUNT(*) AS withdrawal_count,
              COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_count,
              COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_cents ELSE 0 END), 0) AS pending_cents,
              COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount_cents ELSE 0 END), 0) AS paid_cents
            FROM affiliate_withdrawals
            WHERE environment = ?`,
      args: [environment],
    }),
    db.execute({
      sql: `SELECT w.request_id, w.telegram_user_id, w.amount_cents, w.status,
                   w.created_at, w.updated_at, w.paid_at,
                   COALESCE(p.telegram_username, '') AS telegram_username,
                   COALESCE(a.email, '') AS email,
                   COALESCE(pay.method, '') AS payout_method,
                   COALESCE(pay.display_hint, '') AS payout_display_hint
            FROM affiliate_withdrawals w
            LEFT JOIN affiliate_profiles p
              ON p.environment = w.environment
             AND p.telegram_user_id = w.telegram_user_id
            LEFT JOIN payping_accounts a
              ON a.telegram_user_id = w.telegram_user_id
             AND a.status = 'active'
            LEFT JOIN affiliate_payout_profiles pay
              ON pay.environment = w.environment
             AND pay.telegram_user_id = w.telegram_user_id
            WHERE w.environment = ?
            ORDER BY CASE WHEN w.status = 'PENDING' THEN 0 ELSE 1 END,
                     w.created_at DESC
            LIMIT ?`,
      args: [environment, safeLimit],
    }),
    db.execute({
      sql: `SELECT
              p.telegram_user_id,
              p.telegram_username,
              p.referral_code,
              p.created_at,
              COALESCE(a.email, '') AS email,
              (SELECT COUNT(*)
                 FROM affiliate_profiles child
                WHERE child.environment = p.environment
                  AND child.referred_by_user_id = p.telegram_user_id) AS referrals,
              (SELECT COUNT(DISTINCT c.referred_user_id)
                 FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS paying_referrals,
              (SELECT COUNT(*)
                 FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS payment_count,
              (SELECT COALESCE(SUM(c.gross_cents), 0)
                 FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS gross_cents,
              (SELECT COALESCE(SUM(c.commission_cents), 0)
                 FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS total_cents,
              (SELECT COALESCE(SUM(CASE WHEN c.status = 'PENDING' THEN c.commission_cents ELSE 0 END), 0)
                 FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS pending_cents,
              (SELECT COALESCE(SUM(CASE WHEN c.status = 'AVAILABLE' THEN c.commission_cents ELSE 0 END), 0)
                 FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS available_cents,
              (SELECT COALESCE(SUM(CASE WHEN c.status = 'WITHDRAWAL_PENDING' THEN c.commission_cents ELSE 0 END), 0)
                 FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS withdrawing_cents,
              (SELECT COALESCE(SUM(CASE WHEN c.status = 'PAID' THEN c.commission_cents ELSE 0 END), 0)
                 FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS paid_cents
            FROM affiliate_profiles p
            LEFT JOIN payping_accounts a
              ON a.telegram_user_id = p.telegram_user_id
             AND a.status = 'active'
            WHERE p.environment = ?
              AND ${TRUE_AFFILIATE_FILTER}
            ORDER BY total_cents DESC, referrals DESC, p.created_at ASC
            LIMIT ?`,
      args: [environment, safeLimit],
    }),
  ]);

  const profileRow = profileStats.rows?.[0] || {};
  const commissionRow = commissionStats.rows?.[0] || {};
  const withdrawalRow = withdrawalStats.rows?.[0] || {};

  return {
    summary: {
      affiliates: Number(profileRow.affiliates || 0),
      commissionCount: Number(commissionRow.commission_count || 0),
      totalCommission: money(commissionRow.total_cents),
      pendingCommission: money(commissionRow.pending_cents),
      availableCommission: money(commissionRow.available_cents),
      withdrawingCommission: money(commissionRow.withdrawing_cents),
      paidCommission: money(commissionRow.paid_cents),
      withdrawalCount: Number(withdrawalRow.withdrawal_count || 0),
      pendingWithdrawalCount: Number(withdrawalRow.pending_count || 0),
      pendingWithdrawalAmount: money(withdrawalRow.pending_cents),
      paidWithdrawalAmount: money(withdrawalRow.paid_cents),
    },
    affiliates: (affiliates.rows || []).map((row) => ({
      userId: String(row.telegram_user_id || ''),
      username: String(row.telegram_username || ''),
      email: String(row.email || ''),
      label: affiliateAdminLabel(row.telegram_username, row.email, row.telegram_user_id),
      referralCode: String(row.referral_code || ''),
      referrals: Number(row.referrals || 0),
      payingReferrals: Number(row.paying_referrals || 0),
      paymentCount: Number(row.payment_count || 0),
      grossSales: money(row.gross_cents),
      totalEarned: money(row.total_cents),
      pending: money(row.pending_cents),
      available: money(row.available_cents),
      withdrawing: money(row.withdrawing_cents),
      paid: money(row.paid_cents),
      createdAt: String(row.created_at || ''),
    })),
    withdrawals: (withdrawals.rows || []).map((row) => ({
      requestId: String(row.request_id || ''),
      userId: String(row.telegram_user_id || ''),
      username: String(row.telegram_username || ''),
      email: String(row.email || ''),
      label: affiliateAdminLabel(row.telegram_username, row.email, row.telegram_user_id),
      amount: money(row.amount_cents),
      status: String(row.status || ''),
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
      paidAt: row.paid_at ? String(row.paid_at) : null,
      payout: row.payout_method ? {
        configured: true,
        method: String(row.payout_method || ''),
        displayHint: String(row.payout_display_hint || ''),
      } : { configured: false },
    })),
  };
}

export async function getAffiliateAdminDetail({ userId, requestId = '' } = {}) {
  const key = validUserId(userId);
  if (!key) {
    const error = new Error('Invalid affiliate user.');
    error.code = 'INVALID_AFFILIATE_USER';
    throw error;
  }

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await releaseMaturedCommissions(db, environment, now);
  await ensureAffiliatePayoutSchema(db);

  const [profileResult, commissionsResult, referralsResult, withdrawalsResult, payoutProfile] = await Promise.all([
    db.execute({
      sql: `SELECT
              p.telegram_user_id, p.telegram_username, p.referral_code, p.created_at,
              COALESCE(a.email, '') AS email,
              (SELECT COUNT(*) FROM affiliate_profiles child
                WHERE child.environment = p.environment
                  AND child.referred_by_user_id = p.telegram_user_id) AS referrals,
              (SELECT COUNT(DISTINCT c.referred_user_id) FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS paying_referrals,
              (SELECT COUNT(*) FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS payment_count,
              (SELECT COALESCE(SUM(c.gross_cents),0) FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS gross_cents,
              (SELECT COALESCE(SUM(c.commission_cents),0) FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS total_cents,
              (SELECT COALESCE(SUM(CASE WHEN c.status='PENDING' THEN c.commission_cents ELSE 0 END),0) FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS pending_cents,
              (SELECT COALESCE(SUM(CASE WHEN c.status='AVAILABLE' THEN c.commission_cents ELSE 0 END),0) FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS available_cents,
              (SELECT COALESCE(SUM(CASE WHEN c.status='WITHDRAWAL_PENDING' THEN c.commission_cents ELSE 0 END),0) FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS withdrawing_cents,
              (SELECT COALESCE(SUM(CASE WHEN c.status='PAID' THEN c.commission_cents ELSE 0 END),0) FROM affiliate_commissions c
                WHERE c.environment = p.environment
                  AND c.referrer_user_id = p.telegram_user_id) AS paid_cents
            FROM affiliate_profiles p
            LEFT JOIN payping_accounts a
              ON a.telegram_user_id = p.telegram_user_id
             AND a.status = 'active'
            WHERE p.environment = ? AND p.telegram_user_id = ?
            LIMIT 1`,
      args: [environment, key],
    }),
    db.execute({
      sql: `SELECT c.commission_id, c.order_number, c.referred_user_id, c.gross_cents,
                   c.rate_bps, c.commission_cents, c.status, c.available_at,
                   c.payout_request_id, c.created_at, c.updated_at,
                   COALESCE(o.telegram_username, '') AS buyer_username,
                   COALESCE(o.status, '') AS order_status,
                   COALESCE(o.paid_at, '') AS order_paid_at
            FROM affiliate_commissions c
            LEFT JOIN support_orders o
              ON o.environment = c.environment
             AND o.order_number = c.order_number
            WHERE c.environment = ? AND c.referrer_user_id = ?
            ORDER BY c.created_at DESC
            LIMIT 200`,
      args: [environment, key],
    }),
    db.execute({
      sql: `SELECT child.telegram_user_id, child.telegram_username, child.referred_at,
                   COALESCE(a.email, '') AS email,
                   (SELECT COUNT(*) FROM affiliate_commissions c
                     WHERE c.environment = child.environment
                       AND c.referrer_user_id = ?
                       AND c.referred_user_id = child.telegram_user_id) AS payment_count,
                   (SELECT COALESCE(SUM(c.gross_cents),0) FROM affiliate_commissions c
                     WHERE c.environment = child.environment
                       AND c.referrer_user_id = ?
                       AND c.referred_user_id = child.telegram_user_id) AS gross_cents,
                   (SELECT COALESCE(SUM(c.commission_cents),0) FROM affiliate_commissions c
                     WHERE c.environment = child.environment
                       AND c.referrer_user_id = ?
                       AND c.referred_user_id = child.telegram_user_id) AS commission_cents
            FROM affiliate_profiles child
            LEFT JOIN payping_accounts a
              ON a.telegram_user_id = child.telegram_user_id
             AND a.status = 'active'
            WHERE child.environment = ? AND child.referred_by_user_id = ?
            ORDER BY child.referred_at DESC
            LIMIT 200`,
      args: [key, key, key, environment, key],
    }),
    db.execute({
      sql: `SELECT request_id, amount_cents, status, created_at, updated_at, paid_at
            FROM affiliate_withdrawals
            WHERE environment = ? AND telegram_user_id = ?
            ORDER BY created_at DESC
            LIMIT 100`,
      args: [environment, key],
    }),
    getAffiliatePayoutProfile({ userId: key }).catch(() => ({ configured: false })),
  ]);

  const profileRow = profileResult.rows?.[0];
  if (!profileRow) {
    const error = new Error('Affiliate tidak dijumpai.');
    error.code = 'AFFILIATE_NOT_FOUND';
    throw error;
  }

  let audit = null;
  if (String(requestId || '').trim()) {
    audit = await auditAffiliateWithdrawalWithExecutor(db, environment, requestId);
    if (audit.exists && audit.userId !== key) {
      audit = { exists: false, verified: false, reason: 'request_owner_mismatch', requestId: String(requestId || '').trim().toUpperCase() };
    }
  }

  return {
    profile: {
      userId: key,
      username: String(profileRow.telegram_username || ''),
      email: String(profileRow.email || ''),
      label: affiliateAdminLabel(profileRow.telegram_username, profileRow.email, key),
      referralCode: String(profileRow.referral_code || ''),
      createdAt: String(profileRow.created_at || ''),
    },
    summary: {
      referrals: Number(profileRow.referrals || 0),
      payingReferrals: Number(profileRow.paying_referrals || 0),
      paymentCount: Number(profileRow.payment_count || 0),
      grossSales: money(profileRow.gross_cents),
      totalEarned: money(profileRow.total_cents),
      pending: money(profileRow.pending_cents),
      available: money(profileRow.available_cents),
      withdrawing: money(profileRow.withdrawing_cents),
      paid: money(profileRow.paid_cents),
    },
    payoutProfile,
    audit,
    commissions: (commissionsResult.rows || []).map((row) => ({
      commissionId: String(row.commission_id || ''),
      orderNumber: String(row.order_number || ''),
      referredUserId: String(row.referred_user_id || ''),
      buyerUsername: String(row.buyer_username || ''),
      grossAmount: money(row.gross_cents),
      ratePercent: (Number(row.rate_bps || 0) / 100).toFixed(2).replace(/\.00$/, ''),
      commissionAmount: money(row.commission_cents),
      status: String(row.status || ''),
      orderStatus: String(row.order_status || ''),
      paidAt: row.order_paid_at ? String(row.order_paid_at) : null,
      availableAt: row.available_at ? String(row.available_at) : null,
      payoutRequestId: row.payout_request_id ? String(row.payout_request_id) : null,
      createdAt: String(row.created_at || ''),
    })),
    referrals: (referralsResult.rows || []).map((row) => ({
      userId: String(row.telegram_user_id || ''),
      username: String(row.telegram_username || ''),
      email: String(row.email || ''),
      label: affiliateAdminLabel(row.telegram_username, row.email, row.telegram_user_id),
      referredAt: row.referred_at ? String(row.referred_at) : null,
      paymentCount: Number(row.payment_count || 0),
      grossSales: money(row.gross_cents),
      commissionGenerated: money(row.commission_cents),
      paying: Number(row.payment_count || 0) > 0,
    })),
    withdrawals: (withdrawalsResult.rows || []).map((row) => ({
      requestId: String(row.request_id || ''),
      amount: money(row.amount_cents),
      status: String(row.status || ''),
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
      paidAt: row.paid_at ? String(row.paid_at) : null,
    })),
  };
}

export async function markAffiliateWithdrawal(requestId, decision) {
  const id = String(requestId || '').trim().toUpperCase();
  const target = String(decision || '').trim().toUpperCase();
  if (!id || !['PAID', 'REJECTED'].includes(target)) {
    return { updated: false, reason: 'invalid_request' };
  }

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const tx = await db.transaction('write');

  try {
    const lookup = await tx.execute({
      sql: `SELECT request_id, telegram_user_id, amount_cents, status
            FROM affiliate_withdrawals
            WHERE environment = ? AND request_id = ?
            LIMIT 1`,
      args: [environment, id],
    });
    const row = lookup.rows?.[0];
    if (!row) {
      await tx.commit();
      return { updated: false, reason: 'not_found' };
    }
    if (String(row.status || '') !== 'PENDING') {
      await tx.commit();
      return {
        updated: false,
        reason: 'already_finalized',
        requestId: id,
        status: String(row.status || ''),
      };
    }

    if (target === 'PAID') {
      const audit = await auditAffiliateWithdrawalWithExecutor(tx, environment, id);
      if (!audit.verified || !audit.canMarkPaid) {
        await tx.commit();
        return {
          updated: false,
          reason: 'audit_mismatch',
          requestId: id,
          status: String(row.status || ''),
          audit,
        };
      }
    }

    const now = new Date().toISOString();
    await tx.execute({
      sql: `UPDATE affiliate_withdrawals
            SET status = ?, updated_at = ?, paid_at = ?
            WHERE environment = ? AND request_id = ? AND status = 'PENDING'`,
      args: [target, now, target === 'PAID' ? now : null, environment, id],
    });

    await tx.execute({
      sql: target === 'PAID'
        ? `UPDATE affiliate_commissions
           SET status = 'PAID', updated_at = ?
           WHERE environment = ? AND payout_request_id = ? AND status = 'WITHDRAWAL_PENDING'`
        : `UPDATE affiliate_commissions
           SET status = 'AVAILABLE', payout_request_id = NULL, updated_at = ?
           WHERE environment = ? AND payout_request_id = ? AND status = 'WITHDRAWAL_PENDING'`,
      args: [now, environment, id],
    });

    await tx.commit();
    return {
      updated: true,
      requestId: id,
      userId: String(row.telegram_user_id || ''),
      amount: money(row.amount_cents),
      status: target,
    };
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
}
