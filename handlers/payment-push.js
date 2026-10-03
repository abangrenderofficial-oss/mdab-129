import {
  isWebPushConfigured,
  registerPushSubscription,
  registerPushSubscriptionForUser,
  sendWebPushTest,
  webPushPublicKey,
} from '../src/support/webpush-payment.js';
import { resolvePayPingIdentity } from '../src/payping/auth.js';

function json(res, status, body) {
  res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      configured: isWebPushConfigured(),
      publicKey: webPushPublicKey(),
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = String(body.action || '').trim().toLowerCase();

  try {
    if (action === 'subscribe') {
      const identity = await resolvePayPingIdentity(req, { allowLegacyDevice: false });
      if (identity?.userId) {
        const result = await registerPushSubscriptionForUser(identity.userId, body.subscription);
        return json(res, 200, {
          ok: true,
          registered: true,
          deviceToken: result.deviceToken,
          linkedAccount: true,
        });
      }
      const result = await registerPushSubscription(body.code, body.subscription);
      return json(res, 200, {
        ok: true,
        registered: true,
        deviceToken: result.deviceToken,
        linkedAccount: false,
      });
    }
    if (action === 'test') {
      const result = await sendWebPushTest(body.deviceToken);
      return json(res, 200, { ok: true, ...result });
    }
    return json(res, 400, { ok: false, error: 'unknown_action' });
  } catch (error) {
    const code = String(error?.code || 'PUSH_REQUEST_FAILED');
    const status = [
      'INVALID_SETUP_CODE',
      'SETUP_CODE_EXPIRED',
      'SETUP_CODE_ALREADY_USED',
      'INVALID_PUSH_SUBSCRIPTION',
      'DEVICE_TOKEN_MISSING',
      'PUSH_DEVICE_NOT_FOUND',
      'PAYPING_TELEGRAM_LINK_REQUIRED',
    ].includes(code) ? 400 : 500;
    console.warn('[payment-push-api] request failed:', code, error?.message);
    return json(res, status, { ok: false, error: code, message: error?.message || 'Push request failed.' });
  }
}
