import { unlink } from 'node:fs/promises';

const dbPath = `/tmp/payping-multibot-${process.pid}.db`;
await unlink(dbPath).catch(() => {});

process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN = 'local-selftest';
process.env.BAYARCASH_SANDBOX = 'true';

const { currentSupportEnvironment, getSupportDb } = await import('../src/support/store.js');
const {
  ensurePayPingCatalogSchema,
  seedDefaultPayPingCatalog,
  listPayPingBots,
  getPayPingBot,
  listPayPingBotAffiliates,
} = await import('../src/payping/catalog.js');

function assert(value, message) {
  if (!value) throw new Error(message);
}

await ensurePayPingCatalogSchema();
await seedDefaultPayPingCatalog();

const db = await getSupportDb();

const environment = currentSupportEnvironment();
const now = new Date().toISOString();

// Seed historical PayPing rows exactly where the old production system stores them.
// The multi-bot layer must read them as MediaX history without moving or deleting them.
await db.execute({
  sql: `INSERT INTO support_orders (
          environment, order_number, telegram_user_id, telegram_username,
          amount_cents, status, payment_intent_id, error_code,
          last_gateway_status, status_description, gateway_transaction_id,
          created_at, updated_at, paid_at
        ) VALUES (?, ?, ?, ?, ?, 'PAID', NULL, NULL, '3', 'paid', 'LEGACY-TX-1', ?, ?, ?)`,
  args: [environment, 'LEGACY-MEDIAX-ORDER', '700001', 'legacybuyer', 1000, now, now, now],
});
await db.execute({
  sql: `INSERT INTO affiliate_profiles (
          environment, telegram_user_id, telegram_username, referral_code,
          referred_by_user_id, referred_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
  args: [environment, '700002', 'legacyaffiliate', 'LEGACYREF', now, now],
});
await db.execute({
  sql: `INSERT INTO affiliate_commissions (
          environment, commission_id, order_number, referrer_user_id,
          referred_user_id, gross_cents, rate_bps, commission_cents,
          status, available_at, payout_request_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, NULL, ?, ?)`,
  args: [environment, 'LEGACY-COMMISSION-1', 'LEGACY-MEDIAX-ORDER', '700002', '700001', 1000, 2000, 200, now, now, now],
});
const tablesResult = await db.execute("SELECT name FROM sqlite_master WHERE type='table'");
const tables = new Set((tablesResult.rows || []).map((row) => String(row.name || '')));
for (const name of [
  'payping_bots',
  'payping_plans',
  'payping_payment_portals',
  'payping_order_context',
  'payping_subscriptions',
  'payping_bot_affiliates',
  'payping_referrals',
  'payping_affiliate_commissions',
]) {
  assert(tables.has(name), `Missing multi-bot table: ${name}`);
}

const bots = await listPayPingBots();
assert(bots.some((bot) => bot.id === 'mediax'), 'MediaX seed missing');
assert(bots.some((bot) => bot.id === 'musix'), 'MusiX seed missing');

const mediax = bots.find((bot) => bot.id === 'mediax');
assert(mediax.successfulPayments === 1, 'Legacy MediaX paid order must remain visible');
assert(mediax.totalReceived === '10.00', 'Legacy MediaX revenue must remain in analytics');
assert(mediax.supporterCount === 1, 'Legacy MediaX supporter must remain counted');

const mediaxAffiliate = await listPayPingBotAffiliates('mediax');
assert(mediaxAffiliate?.source === 'legacy_mediax', 'MediaX must use legacy affiliate ledger');
assert(
  mediaxAffiliate.affiliates.some((item) => item.userId === '700002' && item.totalEarned === '2.00'),
  'Legacy MediaX affiliate analytics must remain visible',
);

const legacyOrder = await db.execute({
  sql: 'SELECT order_number, amount_cents, status FROM support_orders WHERE environment = ? AND order_number = ?',
  args: [environment, 'LEGACY-MEDIAX-ORDER'],
});
const legacyAffiliate = await db.execute({
  sql: 'SELECT telegram_user_id, referral_code FROM affiliate_profiles WHERE environment = ? AND telegram_user_id = ?',
  args: [environment, '700002'],
});
const legacyCommission = await db.execute({
  sql: 'SELECT commission_id, commission_cents, status FROM affiliate_commissions WHERE environment = ? AND commission_id = ?',
  args: [environment, 'LEGACY-COMMISSION-1'],
});
assert(legacyOrder.rows?.length === 1, 'Legacy payment row was deleted');
assert(Number(legacyOrder.rows?.[0]?.amount_cents || 0) === 1000, 'Legacy payment row was mutated');
assert(legacyAffiliate.rows?.length === 1, 'Legacy affiliate profile was deleted');
assert(legacyAffiliate.rows?.[0]?.referral_code === 'LEGACYREF', 'Legacy affiliate profile was mutated');
assert(legacyCommission.rows?.length === 1, 'Legacy commission row was deleted');
assert(Number(legacyCommission.rows?.[0]?.commission_cents || 0) === 200, 'Legacy commission row was mutated');

const musix = await getPayPingBot('musix');
assert(musix, 'MusiX detail missing');
assert(musix.name === 'MusiX Downloader', 'Unexpected MusiX name');
assert(musix.affiliateEnabled === false, 'MusiX affiliate should default OFF');
assert(musix.plans.length === 1, 'MusiX should start with exactly one plan');
assert(musix.plans[0].id === 'musix-annual-30', 'Unexpected MusiX plan id');
assert(musix.plans[0].amountCents === 3000, 'MusiX annual plan must be RM30');
assert(musix.plans[0].durationDays === 365, 'MusiX annual plan must be 365 days');
assert(musix.portals.length === 1, 'MusiX portal placeholder missing');
assert(
  musix.portals[0].portalKeyEnv === 'BAYARCASH_MUSIC_PORTAL_KEY',
  'MusiX portal must use dedicated portal-key env reference',
);
assert(musix.portals[0].configured === false, 'Test portal must remain unconfigured');

console.log('PAYPING_MULTIBOT_CONTRACT_OK', JSON.stringify({
  bots: bots.map((bot) => bot.id),
  mediaxLegacyPreserved: {
    received: mediax.totalReceived,
    affiliateEarned: mediaxAffiliate.affiliates.find((item) => item.userId === '700002')?.totalEarned,
  },
  musixPlan: {
    amountCents: musix.plans[0].amountCents,
    durationDays: musix.plans[0].durationDays,
  },
}));
