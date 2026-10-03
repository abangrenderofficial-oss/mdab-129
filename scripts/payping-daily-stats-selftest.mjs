import { unlink } from 'node:fs/promises';

const dbPath = `/tmp/payping-daily-stats-selftest-${process.pid}.db`;
await unlink(dbPath).catch(() => {});
process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN = 'local-selftest';
process.env.BAYARCASH_SANDBOX = 'true';

const {
  createPendingSupport,
  applyBayarcashTransaction,
  getSupportDb,
  currentSupportEnvironment,
} = await import('../src/support/store.js');
const {
  ensureAffiliateProfile,
  lockAffiliateReferral,
} = await import('../src/affiliate/store.js');
const {
  getPayPingDashboard,
} = await import('../src/payping/dashboard.js');

function assert(value, message) {
  if (!value) throw new Error(message);
}

const supporterId = '123456789';
const affiliateId = '987654321';
const orderNumber = 'SUP-DAILY-PERSIST-SELFTEST';

const affiliate = await ensureAffiliateProfile({
  userId: affiliateId,
  username: 'affiliate_daily_test',
});
await lockAffiliateReferral({
  userId: supporterId,
  username: 'supporter_daily_test',
  referralCode: affiliate.referralCode,
});

await createPendingSupport({
  orderNumber,
  userId: supporterId,
  username: 'supporter_daily_test',
  amount: 10,
});
await applyBayarcashTransaction({
  order_number: orderNumber,
  transaction_id: 'trx_daily_persist_selftest',
  status: '3',
  amount: '10.00',
  status_description: 'Successful',
});

const ownerFirst = await getPayPingDashboard({
  userId: '111111111',
  owner: true,
  role: 'owner',
});
const affiliateFirst = await getPayPingDashboard({
  userId: affiliateId,
  owner: false,
  role: 'affiliate',
});
const supporterFirst = await getPayPingDashboard({
  userId: supporterId,
  owner: false,
  role: 'user',
});

assert(ownerFirst.summary.todayReceived === '10.00', 'owner today received should persist');
assert(ownerFirst.summary.todayTransactions === 1, 'owner today count should persist');
assert(affiliateFirst.summary.todayReceived === '10.00', 'affiliate today received should persist');
assert(affiliateFirst.summary.todayTransactions === 1, 'affiliate today count should persist');
assert(supporterFirst.summary.todayReceived === '10.00', 'supporter today received should persist');
assert(supporterFirst.summary.todayTransactions === 1, 'supporter today count should persist');

const db = await getSupportDb();
await db.execute({
  sql: `UPDATE support_orders
        SET paid_at = '2020-01-01T00:00:00.000Z'
        WHERE environment = ? AND order_number = ?`,
  args: [currentSupportEnvironment(), orderNumber],
});

const ownerAfter = await getPayPingDashboard({
  userId: '111111111',
  owner: true,
  role: 'owner',
});
const affiliateAfter = await getPayPingDashboard({
  userId: affiliateId,
  owner: false,
  role: 'affiliate',
});
const supporterAfter = await getPayPingDashboard({
  userId: supporterId,
  owner: false,
  role: 'user',
});

assert(ownerAfter.summary.todayReceived === '10.00', 'owner persisted today value disappeared');
assert(ownerAfter.summary.todayTransactions === 1, 'owner persisted today count disappeared');
assert(affiliateAfter.summary.todayReceived === '10.00', 'affiliate persisted today value disappeared');
assert(affiliateAfter.summary.todayTransactions === 1, 'affiliate persisted today count disappeared');
assert(supporterAfter.summary.todayReceived === '10.00', 'supporter persisted today value disappeared');
assert(supporterAfter.summary.todayTransactions === 1, 'supporter persisted today count disappeared');

console.log('PAYPING_DAILY_STATS_SELFTEST_OK', JSON.stringify({
  owner: ownerAfter.summary.todayReceived,
  affiliate: affiliateAfter.summary.todayReceived,
  supporter: supporterAfter.summary.todayReceived,
  count: ownerAfter.summary.todayTransactions,
}));
