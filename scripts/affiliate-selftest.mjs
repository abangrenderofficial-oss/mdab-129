import { unlink } from 'node:fs/promises';

const dbPath = `/tmp/payping-affiliate-selftest-${process.pid}.db`;
await unlink(dbPath).catch(() => {});

process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN = 'local-selftest';
process.env.BAYARCASH_SANDBOX = 'true';
process.env.AFFILIATE_COMMISSION_PERCENT = '20';
process.env.AFFILIATE_HOLD_DAYS = '0';
process.env.AFFILIATE_MIN_WITHDRAW_RM = '1';
process.env.SETUP_SECRET = 'affiliate-selftest-encryption-secret';

const {
  ensureAffiliateProfile,
  lockAffiliateReferral,
  getAffiliateDashboard,
  createAffiliateWithdrawal,
  markAffiliateWithdrawal,
  saveAffiliatePayoutProfile,
} = await import('../src/affiliate/store.js');
const {
  createPendingSupport,
  markSupportIntentCreated,
  applyBayarcashTransaction,
} = await import('../src/support/store.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const referrerId = 700000001;
const buyerId = 700000002;
const otherId = 700000003;

const referrer = await ensureAffiliateProfile({ userId: referrerId, username: 'referrer_test' });
const other = await ensureAffiliateProfile({ userId: otherId, username: 'other_test' });

const linked = await lockAffiliateReferral({
  userId: buyerId,
  username: 'buyer_test',
  referralCode: `ref_${referrer.referralCode}`,
});
assert(linked.applied === true, 'buyer should link to referrer');

const relink = await lockAffiliateReferral({
  userId: buyerId,
  username: 'buyer_test',
  referralCode: other.referralCode,
});
assert(relink.applied === false && relink.reason === 'referrer_locked', 'referrer must remain locked');

const self = await lockAffiliateReferral({
  userId: referrerId,
  username: 'referrer_test',
  referralCode: referrer.referralCode,
});
assert(self.applied === false && self.reason === 'self_referral', 'self referral must be blocked');

const orderNumber = `AFFTEST-${Date.now()}`;
await createPendingSupport({
  orderNumber,
  userId: buyerId,
  username: 'buyer_test',
  amount: 10,
});
await markSupportIntentCreated(orderNumber, 'AFF-INTENT-1');

const paid = await applyBayarcashTransaction({
  order_number: orderNumber,
  transaction_id: 'AFF-TX-1',
  amount: '10.00',
  status: '3',
  status_description: 'Successful',
});
assert(paid.becamePaid === true, 'payment should become paid');
assert(paid.affiliate?.created === true, 'affiliate commission should be created');
assert(paid.affiliate?.commissionAmount === '2.00', '20% of RM10 should be RM2');

const dashboard = await getAffiliateDashboard({ userId: referrerId, username: 'referrer_test' });
assert(dashboard.referrals === 1, 'referral count should be 1');
assert(dashboard.payingReferrals === 1, 'paying referral count should be 1');
assert(dashboard.available === '2.00', 'matured available commission should be RM2');
assert(dashboard.totalEarned === '2.00', 'total earned should be RM2');

const duplicate = await applyBayarcashTransaction({
  order_number: orderNumber,
  transaction_id: 'AFF-TX-1',
  amount: '10.00',
  status: '3',
  status_description: 'Successful',
});
assert(duplicate.duplicate === true, 'duplicate callback should be detected');
assert(!duplicate.affiliate, 'duplicate callback must not create another commission');

const afterDuplicate = await getAffiliateDashboard({ userId: referrerId });
assert(afterDuplicate.totalEarned === '2.00', 'duplicate callback must not change affiliate total');

const blockedWithdrawal = await createAffiliateWithdrawal({
  userId: referrerId,
  username: 'referrer_test',
});
assert(
  blockedWithdrawal.created === false && blockedWithdrawal.reason === 'payout_profile_required',
  'withdrawal should require payout profile first',
);

const payout = await saveAffiliatePayoutProfile({
  userId: referrerId,
  payout: {
    method: 'BANK',
    bankName: 'Test Bank',
    accountName: 'Referrer Test',
    accountNumber: '1234567890',
  },
});
assert(payout.configured === true && payout.readable === true, 'payout profile should save');

const withdrawal = await createAffiliateWithdrawal({
  userId: referrerId,
  username: 'referrer_test',
});
assert(withdrawal.created === true, 'withdrawal should be created after payout setup');
assert(withdrawal.amount === '2.00', 'withdrawal should claim RM2');

const duringWithdrawal = await getAffiliateDashboard({ userId: referrerId });
assert(duringWithdrawal.available === '0.00', 'claimed commission should leave available balance');
assert(duringWithdrawal.withdrawing === '2.00', 'claimed commission should be withdrawing');

const finalized = await markAffiliateWithdrawal(withdrawal.requestId, 'PAID');
assert(finalized.updated === true && finalized.status === 'PAID', 'withdrawal should finalize as paid');

const finalDashboard = await getAffiliateDashboard({ userId: referrerId });
assert(finalDashboard.paid === '2.00', 'paid wallet total should be RM2');
assert(finalDashboard.totalEarned === '2.00', 'final total earned should remain RM2');

console.log('AFFILIATE_SELFTEST_OK', JSON.stringify({
  referralCode: referrer.referralCode,
  commission: paid.affiliate.commissionAmount,
  withdrawal: withdrawal.amount,
  totalEarned: finalDashboard.totalEarned,
}));
