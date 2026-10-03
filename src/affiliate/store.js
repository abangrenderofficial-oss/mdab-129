import { randomBytes } from 'node:crypto';

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
