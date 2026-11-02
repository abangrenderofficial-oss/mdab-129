import { isBayarcashConfigured, isBayarcashSandbox, verifyTransactionCallback } from '../src/payments/bayarcash.js';
import { applyBayarcashTransaction } from '../src/support/store.js';
import { afterSupportTransaction } from '../src/support/after-payment.js';

function json(res, status, body) {
  res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      service: 'bayarcash-callback',
      environment: isBayarcashSandbox() ? 'sandbox' : 'production',
      configured: isBayarcashConfigured(),
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const valid = verifyTransactionCallback(payload);

  if (!valid) {
    console.warn('[bayarcash] rejected callback with invalid checksum', {
      environment: isBayarcashSandbox() ? 'sandbox' : 'production',
      order_number: payload?.order_number || null,
      status: payload?.status || null,
    });
    return json(res, 400, { ok: false, error: 'invalid_checksum' });
  }

  const result = await applyBayarcashTransaction(payload);
  console.log('[bayarcash] verified support callback', {
    environment: isBayarcashSandbox() ? 'sandbox' : 'production',
    order_number: payload?.order_number || null,
    transaction_id: payload?.transaction_id || null,
    amount: payload?.amount || null,
    status: payload?.status || null,
    known_order: result?.knownOrder || false,
    became_paid: result?.becamePaid || false,
    duplicate: result?.duplicate || false,
    amount_mismatch: result?.amountMismatch || false,
  });

  await afterSupportTransaction(result, { sandbox: isBayarcashSandbox() });

  // Support testimonial/feedback publishing is intentionally disabled for now.
  return json(res, 200, { ok: true });
}
