import { readFile } from 'node:fs/promises';

const [api, server, router, vercel, push, identity, authStore, store, page, home] = await Promise.all([
  readFile('handlers/affiliate-web.js', 'utf8'),
  readFile('server.js', 'utf8'),
  readFile('api/router.js', 'utf8'),
  readFile('vercel.json', 'utf8'),
  readFile('src/support/webpush-payment.js', 'utf8'),
  readFile('src/payping/identity.js', 'utf8'),
  readFile('src/payping/auth.js', 'utf8'),
  readFile('src/affiliate/store.js', 'utf8'),
  readFile('handlers/affiliate-pwa.js', 'utf8'),
  readFile('handlers/payment-pwa.js', 'utf8'),
]);

const must = (source, marker, label) => {
  if (!source.includes(marker)) throw new Error(`${label} missing: ${marker}`);
};

must(api, 'resolvePayPingIdentity', 'API unified auth');
must(identity, 'getPayPingSessionAccount', 'PayPing account session auth');
must(identity, 'resolvePushDeviceOwner', 'Legacy device auth fallback');
must(authStore, 'payping_sessions', 'PayPing session store');
must(authStore, 'payping_link_codes', 'PayPing Telegram link codes');
must(api, "action === 'withdraw'", 'API withdrawal');
must(api, 'getAffiliateActivity', 'API activity');
must(identity, 'headers?.authorization', 'Unified API authorization');
must(push, 'export async function resolvePushDeviceOwner', 'Device owner resolver');
must(push, "disabled_at = ''", 'Active device guard');
must(store, 'export async function getAffiliateActivity', 'Affiliate activity store');
must(store, 'affiliate_commissions', 'Commission history query');
must(store, 'affiliate_withdrawals', 'Withdrawal history query');
must(page, "fetch('/api/affiliate-web'", 'Affiliate PWA API');
must(page, "localStorage.getItem(authKey)", 'Affiliate PWA account session');
must(page, "localStorage.getItem(deviceKey)", 'Affiliate PWA legacy device fallback');
must(page, "body:JSON.stringify({action:'withdraw'})", 'Affiliate PWA withdrawal');
must(page, 'Copy Link', 'Affiliate PWA copy referral');
must(page, 'Share Link', 'Affiliate PWA share referral');
must(home, 'Open Affiliate / Earn', 'PayPing home entry');
must(server, "['/api/affiliate-web', affiliateWebHandler]", 'Node affiliate API route');
must(server, "['/ar-payment/affiliate', affiliatePwaPageHandler]", 'Node affiliate page route');
must(router, "['affiliate-web', affiliateWebHandler]", 'Vercel affiliate API route');
must(router, "['affiliate-pwa-page', affiliatePwaPageHandler]", 'Vercel affiliate page route');
must(router, "['payping-auth', payPingAuthHandler]", 'Vercel auth API route');
must(router, "['payping-login-page', payPingLoginPage]", 'Vercel login page route');

const config = JSON.parse(vercel);
for (const source of [
  '/api/affiliate-web',
  '/ar-payment/affiliate',
  '/ar-payment/affiliate/',
  '/api/payping-auth',
  '/ar-payment/login',
  '/ar-payment/register',
  '/ar-payment/onboarding',
]) {
  if (!config.rewrites.some((entry) => entry.source === source)) {
    throw new Error(`Vercel rewrite missing: ${source}`);
  }
}

if (/body\.userId|query\.userId/.test(api)) {
  throw new Error('Affiliate web API must not trust a client-supplied Telegram user ID.');
}

console.log('PAYPING_AFFILIATE_WEB_SELFTEST_OK');
