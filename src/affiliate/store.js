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

export async function getAffiliateAdminDashboard({ limit = 50 } = {}) {
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await releaseMaturedCommissions(db, environment, now);
  await ensureAffiliatePayoutSchema(db);

  const safeLimit = Math.max(1, Math.min(200, Number(limit || 50)));

  const [profileStats, commissionStats, withdrawalStats, withdrawals] = await Promise.all([
    db.execute({
      sql: `SELECT
              COUNT(*) AS affiliates,
              SUM(CASE WHEN referred_by_user_id IS NOT NULL THEN 1 ELSE 0 END) AS referred_users
            FROM affiliate_profiles
            WHERE environment = ?`,
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
                   COALESCE(pay.method, '') AS payout_method,
                   COALESCE(pay.display_hint, '') AS payout_display_hint,
                   COALESCE(pay.details_ciphertext, '') AS payout_details_ciphertext
            FROM affiliate_withdrawals w
            LEFT JOIN affiliate_profiles p
              ON p.environment = w.environment
             AND p.telegram_user_id = w.telegram_user_id
            LEFT JOIN affiliate_payout_profiles pay
              ON pay.environment = w.environment
             AND pay.telegram_user_id = w.telegram_user_id
            WHERE w.environment = ?
            ORDER BY CASE WHEN w.status = 'PENDING' THEN 0 ELSE 1 END,
                     w.created_at DESC
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
      referredUsers: Number(profileRow.referred_users || 0),
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
    withdrawals: (withdrawals.rows || []).map((row) => ({
      requestId: String(row.request_id || ''),
      userId: String(row.telegram_user_id || ''),
      username: String(row.telegram_username || ''),
      amount: money(row.amount_cents),
      status: String(row.status || ''),
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
      paidAt: row.paid_at ? String(row.paid_at) : null,
      payout: row.payout_method ? {
        configured: true,
        method: String(row.payout_method || ''),
        displayHint: String(row.payout_display_hint || ''),
        details: decryptPayoutDetails(row.payout_details_ciphertext),
      } : { configured: false },
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
