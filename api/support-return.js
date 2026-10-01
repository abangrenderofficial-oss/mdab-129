import { reconcileSupportPayment } from '../src/support/reconcile.js';
import { sendMessage } from '../src/telegram.js';

function firstQueryValue(value) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function parseReturnIdentifiers(query = {}) {
  let orderNumber = firstQueryValue(query?.order).trim();
  let paymentIntentId = firstQueryValue(query?.payment_intent_id).trim();

  // Bayarcash may append `?payment_intent_id=...` to an existing return URL
  // instead of using `&payment_intent_id=...`. In that case URLSearchParams
  // treats it as part of the `order` value, so split it back out here.
  const malformedIntentMarker = '?payment_intent_id=';
  const markerIndex = orderNumber.indexOf(malformedIntentMarker);
  if (markerIndex >= 0) {
    const embedded = orderNumber.slice(markerIndex + malformedIntentMarker.length).split(/[&#]/)[0].trim();
    orderNumber = orderNumber.slice(0, markerIndex).trim();
    if (!paymentIntentId && embedded) paymentIntentId = embedded;
  }

  return { orderNumber, paymentIntentId };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const { orderNumber, paymentIntentId } = parseReturnIdentifiers(req?.query || {});
  let reconciliation = null;
  let lookupError = null;

  if (orderNumber || paymentIntentId) {
    try {
      reconciliation = await reconcileSupportPayment({ orderNumber, paymentIntentId });
      console.log('[support-return] Bayarcash reconciliation', {
        order_number: orderNumber || reconciliation?.orderNumber || null,
        payment_intent_id: paymentIntentId || reconciliation?.paymentIntentId || null,
        paid: reconciliation?.paid || false,
        intent_status: reconciliation?.intentStatus || null,
        transaction_status: reconciliation?.transactionStatus || null,
        transaction_id: reconciliation?.transactionId || null,
      });

      if (reconciliation?.result?.becamePaid && reconciliation?.result?.telegramUserId) {
        const amount = reconciliation?.result?.amount || reconciliation?.amount || '';
        await sendMessage(
          reconciliation.result.telegramUserId,
          [
            '✅ Bayarcash confirmed payment',
            amount ? `Amount: RM${amount}` : '',
            reconciliation.orderNumber ? `Support ID: ${reconciliation.orderNumber}` : '',
            reconciliation.transactionId ? `Transaction: ${reconciliation.transactionId}` : '',
          ].filter(Boolean).join('\n'),
        ).catch((error) => console.warn('[support-return] Telegram confirmation failed:', error?.message));
      }
    } catch (error) {
      lookupError = error;
      console.error('[support-return] Bayarcash reconciliation failed:', error?.code, error?.status, error?.message);
    }
  }

  const paid = Boolean(reconciliation?.paid);
  const status = reconciliation?.intentStatus || reconciliation?.transactionStatus || (lookupError ? 'lookup failed' : 'pending');
  const title = paid ? 'Payment Confirmed ✅' : 'Payment sedang disemak';
  const detail = paid
    ? 'Bayarcash API telah sahkan payment ini berjaya.'
    : 'Return page diterima. Status payment akan disemak terus dengan Bayarcash.';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!doctype html>
<html lang="ms">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Support Bot</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#111;color:#fff;margin:0;display:grid;min-height:100vh;place-items:center;padding:24px;box-sizing:border-box}
    .card{max-width:560px;background:#1b1b1b;border:1px solid #333;border-radius:22px;padding:28px;text-align:center;box-shadow:0 18px 60px rgba(0,0,0,.35)}
    h1{font-size:28px;margin:0 0 12px}p{color:#d2d2d2;line-height:1.6;margin:8px 0}.heart{font-size:44px;margin-bottom:12px}.meta{font-size:14px;color:#aaa;margin-top:18px;word-break:break-word}
  </style>
</head>
<body>
  <main class="card">
    <div class="heart">${paid ? '✅' : '🔎'}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(detail)}</p>
    ${orderNumber ? `<p class="meta">Support ID: ${escapeHtml(orderNumber)}</p>` : ''}
    ${paymentIntentId ? `<p class="meta">Payment Intent: ${escapeHtml(paymentIntentId)}</p>` : ''}
    <p class="meta">Bayarcash status: ${escapeHtml(status)}</p>
    <p>Boleh kembali ke Telegram dan tekan “Check Bayarcash” jika mahu semak sekali lagi.</p>
  </main>
</body>
</html>`);
}
