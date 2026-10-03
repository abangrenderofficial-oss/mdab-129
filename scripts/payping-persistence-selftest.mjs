import { execFileSync } from 'node:child_process';
import { unlink } from 'node:fs/promises';

const dbPath = `/tmp/payping-persistence-contract-${process.pid}.db`;
await unlink(dbPath).catch(() => {});

const env = {
  ...process.env,
  TURSO_DATABASE_URL: `file:${dbPath}`,
  TURSO_AUTH_TOKEN: 'local-selftest',
  BAYARCASH_SANDBOX: 'true',
  WEB_PUSH_PUBLIC_KEY: '',
  WEB_PUSH_PRIVATE_KEY: '',
};

const createScript = `
  const { getSupportDb } = await import('./src/support/store.js');
  const { ensurePayPingAuthSchema } = await import('./src/payping/auth.js');
  const { ensureSubmissionSchema } = await import('./src/support/submissions.js');
  const { ensurePaymentFollowupSchema } = await import('./src/support/payment-followup.js');
  const { ensureWebPushSchema } = await import('./src/support/webpush-payment.js');
  const { getAffiliatePayoutProfile } = await import('./src/affiliate/store.js');

  await ensurePayPingAuthSchema();
  await ensureSubmissionSchema();
  await ensurePaymentFollowupSchema();
  await ensureWebPushSchema();
  await getAffiliatePayoutProfile('1234567890');

  const db = await getSupportDb();
  await db.execute({
    sql: "INSERT INTO payping_daily_stats (environment, local_date, scope_type, scope_user_id, received_cents, successful_count, updated_at) VALUES ('sandbox','2099-01-01','owner','*',12345,7,'2099-01-01T00:00:00.000Z')"
  });
`;

execFileSync(process.execPath, ['--input-type=module', '-e', createScript], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});

const verifyScript = `
  const { getSupportDb } = await import('./src/support/store.js');
  const db = await getSupportDb();
  const required = [
    'support_orders',
    'support_transactions',
    'support_users',
    'affiliate_profiles',
    'affiliate_commissions',
    'affiliate_withdrawals',
    'affiliate_payout_profiles',
    'support_submissions',
    'support_payment_followups',
    'support_affiliate_followups',
    'support_push_setup_codes',
    'support_push_subscriptions',
    'support_webpush_delivery',
    'payping_accounts',
    'payping_sessions',
    'payping_telegram_link_codes',
    'payping_daily_stats'
  ];

  const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table'");
  const names = new Set((tables.rows || []).map(row => String(row.name || '')));
  for (const name of required) {
    if (!names.has(name)) throw new Error('Missing persistent table: ' + name);
  }

  const sentinel = await db.execute({
    sql: "SELECT received_cents, successful_count FROM payping_daily_stats WHERE environment='sandbox' AND local_date='2099-01-01' AND scope_type='owner' AND scope_user_id='*' LIMIT 1"
  });
  const row = sentinel.rows?.[0];
  if (Number(row?.received_cents || 0) !== 12345 || Number(row?.successful_count || 0) !== 7) {
    throw new Error('Persistent sentinel did not survive process restart');
  }

  console.log('PAYPING_PERSISTENCE_CONTRACT_OK', JSON.stringify({
    tables: required.length,
    receivedCents: Number(row.received_cents),
    successfulCount: Number(row.successful_count)
  }));
`;

execFileSync(process.execPath, ['--input-type=module', '-e', verifyScript], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});
