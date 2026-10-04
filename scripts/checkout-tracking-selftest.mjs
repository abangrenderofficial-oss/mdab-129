import { unlink, readFile } from 'node:fs/promises';

const dbPath = '/tmp/checkout-tracking-selftest-' + process.pid + '.db';
await unlink(dbPath).catch(() => {});
process.env.TURSO_DATABASE_URL = 'file:' + dbPath;
process.env.TURSO_AUTH_TOKEN = 'local-selftest';
process.env.BAYARCASH_SANDBOX = 'true';
process.env.BAYARCASH_SANDBOX_API_SECRET_KEY = 'checkout-tracking-selftest-secret';

const {
  createSupportSubmission,
  getSupportSubmission,
  markSupportSubmissionCheckout,
} = await import('../src/support/submissions.js');
const {
  createSupportCheckoutTrackingUrl,
  resolveSupportCheckoutRedirect,
  verifySupportCheckoutSignature,
} = await import('../src/support/checkout-tracking.js');

function assert(value, message) {
  if (!value) throw new Error('CHECKOUT_TRACKING_SELFTEST_FAILED: ' + message);
}
function must(source, needle, label) {
  if (!source.includes(needle)) throw new Error('CHECKOUT_TRACKING_SELFTEST_FAILED: ' + label + ' missing ' + needle);
}

const order = 'TST-CHECKOUT-TRACK-1';
await createSupportSubmission({
  orderNumber: order,
  userId: '123456789',
  username: 'checkout_test',
  amount: 10,
  tierKey: 'supporter',
  tierLabel: '🤍 Supporter',
});
await markSupportSubmissionCheckout(order, 'https://example-gateway.test/pay/abc', 'pi_checkout_test');

const trackedUrl = createSupportCheckoutTrackingUrl({
  publicBaseUrl: 'https://payping.example',
  orderNumber: order,
});
const parsed = new URL(trackedUrl);
const sig = parsed.searchParams.get('sig');
assert(parsed.pathname === '/api/support-checkout', 'tracking route path');
assert(parsed.searchParams.get('order') === order, 'tracking order');
assert(verifySupportCheckoutSignature(order, sig), 'valid signature');
assert(!verifySupportCheckoutSignature(order, sig.slice(0, -1) + 'x'), 'tampered signature blocked');

const first = await resolveSupportCheckoutRedirect({ orderNumber: order, signature: sig, recordOpen: true });
assert(first.paymentUrl.startsWith('https://example-gateway.test/'), 'gateway redirect');
assert(first.openCount === 1, 'first open count');

const second = await resolveSupportCheckoutRedirect({ orderNumber: order, signature: sig, recordOpen: true });
assert(second.openCount === 2, 'second open count');

const submission = await getSupportSubmission(order);
assert(submission.checkoutOpenCount === 2, 'persisted open count');
assert(Boolean(submission.checkoutFirstOpenedAt), 'first open timestamp');
assert(Boolean(submission.checkoutLastOpenedAt), 'last open timestamp');

let invalidBlocked = false;
try {
  await resolveSupportCheckoutRedirect({ orderNumber: order, signature: 'bad', recordOpen: true });
} catch (error) {
  invalidBlocked = error?.code === 'CHECKOUT_LINK_INVALID';
}
assert(invalidBlocked, 'invalid signature rejected');

const [supportSource, handlerSource, dashboardSource, detailSource, serverSource, routerSource] = await Promise.all([
  readFile('src/features/support.js', 'utf8'),
  readFile('handlers/support-checkout.js', 'utf8'),
  readFile('src/payping/dashboard.js', 'utf8'),
  readFile('handlers/payping-transaction-detail-pwa.js', 'utf8'),
  readFile('server.js', 'utf8'),
  readFile('api/router.js', 'utf8'),
]);
must(supportSource, 'createSupportCheckoutTrackingUrl', 'Telegram pay button tracking');
must(supportSource, 'url: trackedPaymentUrl', 'Telegram pay button uses tracked route');
must(handlerSource, 'res.statusCode = 302', 'tracking redirect');
must(handlerSource, 'Referrer-Policy', 'redirect privacy');
must(dashboardSource, 'checkoutOpenCount', 'PayPing tracking detail');
must(detailSource, 'Checkout Opened', 'PayPing tracking UI');
must(serverSource, "['/api/support-checkout', supportCheckoutHandler]", 'Railway checkout route');
must(routerSource, "['support-checkout', supportCheckoutHandler]", 'Vercel checkout route');

console.log('CHECKOUT_TRACKING_SELFTEST_OK', JSON.stringify({
  openCount: submission.checkoutOpenCount,
  firstOpenedAt: submission.checkoutFirstOpenedAt,
  lastOpenedAt: submission.checkoutLastOpenedAt,
}));
