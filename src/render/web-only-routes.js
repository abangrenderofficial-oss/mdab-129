// Render web-only route gate. It permits PayPing/affiliate web traffic without
// starting bot schedulers or accepting Telegram webhooks or payment callbacks.
// Every route is still protected by the original per-handler authentication.
const routes = new Set([
  '/api/health',
  '/api/heavy-limit',
  '/api/payping-data',
  '/api/payping-auth',
  '/api/payping-settings',
  '/api/payping-bot-admin',
  '/api/payment-push',
  '/api/affiliate-web',
  '/api/affiliate-admin',
]);

export function isWebOnlyRequestAllowed(pathname, method) {
  const path = String(pathname || '');
  const verb = String(method || '').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') {
    if (path === '/' || path === '/healthz' || path === '/readyz') return true;
    if (path === '/ar-payment' || path.startsWith('/ar-payment/')) return true;
    return routes.has(path);
  }
  if (verb !== 'POST') return false;
  // Handler-level identity checks remain required on every POST, exactly as on Vercel.
  // Telegram/webhook, setup, payment gateway and signed HQ callback endpoints stay disabled.
  return routes.has(path) && !['/api/health', '/api/heavy-limit'].includes(path);
}

export const forbiddenWebOnlyPaths = Object.freeze([
  '/api/telegram', '/api/setup', '/api/setup-webhook', '/api/media',
  '/api/bayarcash', '/api/support-return', '/api/support-checkout',
  '/api/premium-hq-success', '/api/content-bridge/connect', '/api/content-bridge/verify',
]);
