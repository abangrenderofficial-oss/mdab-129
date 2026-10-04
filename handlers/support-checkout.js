import { resolveSupportCheckoutRedirect } from '../src/support/checkout-tracking.js';

function first(value) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function errorPage(message) {
  const safe = String(message || 'Checkout link tidak dapat dibuka.')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Payment</title></head><body style="font-family:system-ui;background:#0b0b10;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px"><div style="max-width:480px;text-align:center"><h2>Payment link tak dapat dibuka</h2><p style="color:#b7b7c5;line-height:1.5">' + safe + '</p><p style="color:#8f8f9e">Kembali ke Telegram dan cuba semula.</p></div></body></html>';
}

export default async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const result = await resolveSupportCheckoutRedirect({
      orderNumber: first(req.query?.order).trim(),
      signature: first(req.query?.sig).trim(),
      recordOpen: req.method === 'GET',
    });

    if (req.method === 'GET') {
      console.log('[checkout-tracking] opened', {
        order_number: result.orderNumber,
        open_count: result.openCount,
      });
    }

    res.statusCode = 302;
    res.setHeader('Location', result.paymentUrl);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.end();
  } catch (error) {
    console.warn('[checkout-tracking] redirect failed:', error?.code, error?.message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(error?.code === 'CHECKOUT_LINK_INVALID' ? 403 : 404)
      .send(errorPage(error?.message));
  }
}
