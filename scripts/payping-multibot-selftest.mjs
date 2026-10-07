import { unlink } from 'node:fs/promises';

const dbPath = `/tmp/payping-multibot-${process.pid}.db`;
await unlink(dbPath).catch(() => {});

process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN = 'local-selftest';
process.env.BAYARCASH_SANDBOX = 'true';

const { getSupportDb } = await import('../src/support/store.js');
const {
  ensurePayPingCatalogSchema,
  seedDefaultPayPingCatalog,
  listPayPingBots,
  getPayPingBot,
} = await import('../src/payping/catalog.js');

function assert(value, message) {
  if (!value) throw new Error(message);
}

await ensurePayPingCatalogSchema();
await seedDefaultPayPingCatalog();

const db = await getSupportDb();
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
  musixPlan: {
    amountCents: musix.plans[0].amountCents,
    durationDays: musix.plans[0].durationDays,
  },
}));
