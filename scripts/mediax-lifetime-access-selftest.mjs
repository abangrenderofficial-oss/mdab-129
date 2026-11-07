// Regression: a lifetime entitlement must override the old 1-year MediaX expiry,
// preserving Power Supporter even when the paid legacy order is past its end date.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir = await mkdtemp(path.join(tmpdir(), 'mediax-lifetime-'));
Object.assign(process.env, {
  TURSO_DATABASE_URL: 'file:' + path.join(dir, 'test.db'),
  TURSO_AUTH_TOKEN: 'local-selftest',
  BAYARCASH_SANDBOX: 'false',
});
try {
  const {getSupportDb,currentSupportEnvironment} = await import('../src/support/store.js');
  const {getActiveSupporterTitle} = await import('../src/support/community-store.js');
  const {ensureSubmissionSchema} = await import('../src/support/submissions.js');
  const db = await getSupportDb();
  await ensureSubmissionSchema();
  const env = currentSupportEnvironment();
  await db.execute("CREATE TABLE IF NOT EXISTS payping_order_plan_snapshots_v2(environment TEXT,order_number TEXT,duration_days INTEGER)");
  await db.execute("CREATE TABLE IF NOT EXISTS payping_subscriptions(environment TEXT NOT NULL,subscription_id TEXT NOT NULL,bot_id TEXT NOT NULL,plan_id TEXT NOT NULL,telegram_user_id TEXT NOT NULL,order_number TEXT NOT NULL,status TEXT NOT NULL,starts_at TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(environment,subscription_id))");
  const paid = '2022-02-03T12:00:00.000Z';
  await db.execute({sql:"INSERT INTO support_orders(environment,order_number,telegram_user_id,telegram_username,amount_cents,status,created_at,updated_at,paid_at) VALUES(?,?,?,?,?,'PAID',?,?,?)",
    args:[env,'PAID-POWER-OLD','543783027','',3000,paid,paid,paid]});
  assert.equal(await getActiveSupporterTitle('543783027'), null, 'old order alone must be expired');
  const now = new Date().toISOString();
  await db.execute({sql:"INSERT INTO payping_subscriptions(environment,subscription_id,bot_id,plan_id,telegram_user_id,order_number,status,starts_at,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    args:[env,'admin-lifetime-test','mediax','mediax-support-30','543783027','ADMIN-LIFETIME-TEST','active',now,'lifetime',now,now]});
  const lifetime = await getActiveSupporterTitle('543783027');
  assert.ok(lifetime, 'explicit lifetime must grant access');
  assert.equal(lifetime.tierKey, 'power');
  assert.equal(lifetime.tierLabel, '💎 Power Supporter');
  assert.equal(lifetime.expiresAt, '9999-12-31T23:59:59.000Z');
  assert.equal(lifetime.amount, '30.00');
  assert.equal(await getActiveSupporterTitle('333000333'), null, 'another user stays locked');
  console.log('MEDIAX_LIFETIME_ACCESS_SELFTEST_OK — expired paid order + active lifetime overrides expiry, retains Power Supporter, no access leak');
} finally {
  await rm(dir, {recursive:true,force:true});
}
