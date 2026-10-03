import { reconcileSupportPayment } from '../src/support/reconcile.js';
import { activateSupportSubmissionAfterPayment, getSupportSubmission } from '../src/support/submissions.js';
import { sendMessage } from '../src/telegram.js';
import { notifySuccessfulSupportPayment } from '../src/support/payment-detail.js';
import { notifyWebPushSupportPayment } from '../src/support/webpush-payment.js';
import { notifyNtfySupportPayment } from '../src/support/ntfy-payment.js';

function firstQueryValue(value) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function requestBody(req = {}) {
  if (req?.body && typeof req.body === 'object') return req.body;
  if (typeof req?.body === 'string') {
    return Object.fromEntries(new URLSearchParams(req.body));
  }
  return {};
}

function parseReturnIdentifiers(source = {}) {
  let orderNumber = firstQueryValue(source?.order).trim();
  let paymentIntentId = firstQueryValue(source?.payment_intent_id).trim();

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

function htmlPage({
  paid,
  status,
  orderNumber,
  paymentIntentId,
  tierLabel,
}) {
  const safeTier = escapeHtml(tierLabel || '❤️ Supporter');
  const safeOrder = escapeHtml(orderNumber || '');
  const safeIntent = escapeHtml(paymentIntentId || '');
  const safeStatus = escapeHtml(status || 'pending');

  const paidContent = `
    <div class="heart">❤️</div>
    <h1>Thank you, Payment Dah Confirm ✅</h1>

    <div class="message">
      <p>Tahniah! Awak dapat tier <strong class="tier-inline">${safeTier}</strong> !</p>

      <p>Kelebihan tier tittle ni contoh bila awak nak bagi kata2 support utk bot atau luah rasa / bercerita / share tips / nasihat di channel dengan command <strong>/luahrasa</strong> di private bot.</p>

      <p>Tier tittle awak akan di tayangkn sekali di channel ! ✨</p>
    </div>
  `;

  const pendingContent = `
    <div class="heart">🔎</div>
    <h1>Payment sedang disemak</h1>
    <p class="lead">Return page diterima. Status payment akan disemak terus dengan Bayarcash.</p>
    ${orderNumber ? `<p class="meta">Support ID: ${safeOrder}</p>` : ''}
    ${paymentIntentId ? `<p class="meta">Payment Intent: ${safeIntent}</p>` : ''}
    <p class="meta">Bayarcash status: ${safeStatus}</p>
    <p>Boleh kembali ke Telegram dan tekan “Check Status” jika mahu semak sekali lagi.</p>
  `;

  return `<!doctype html>
<html lang="ms">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Support Bot</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0d0d0f;color:#fff;margin:0;min-height:100vh;padding:28px 18px;display:flex;align-items:center}
    .wrap{width:100%;max-width:620px;margin:0 auto}
    .card{background:#1a1a1d;border:1px solid #343438;border-radius:24px;padding:30px;box-shadow:0 18px 60px rgba(0,0,0,.38)}
    .heart{font-size:48px;text-align:center;margin-bottom:12px}
    h1{font-size:30px;line-height:1.2;text-align:center;margin:0 0 26px}
    p{color:#d4d4d8;line-height:1.7;margin:0 0 18px;font-size:17px}
    .lead{text-align:center}
    .message{padding:22px;background:#131316;border:1px solid #303036;border-radius:18px}
    .message p:last-child{margin-bottom:0}
    .tier-inline{color:#fff}
    .meta{font-size:14px;color:#aaa;word-break:break-word;text-align:center}
    strong{color:#fff}
    @media(max-width:480px){.card{padding:22px 18px}h1{font-size:26px}.message{padding:18px}}
  </style>
</head>
<body>
  <div class="wrap">
    <main class="card">
      ${paid ? paidContent : pendingContent}
    </main>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const source = req.method === 'POST' ? requestBody(req) : (req?.query || {});
  const parsed = parseReturnIdentifiers(source);
  let orderNumber = parsed.orderNumber;
  let paymentIntentId = parsed.paymentIntentId;
  let reconciliation = null;
  let lookupError = null;
  let submission = null;

  if (orderNumber || paymentIntentId) {
    try {
      reconciliation = await reconcileSupportPayment({ orderNumber, paymentIntentId });
      orderNumber = reconciliation?.orderNumber || orderNumber;
      paymentIntentId = reconciliation?.paymentIntentId || paymentIntentId;

      console.log('[support-return] Bayarcash reconciliation', {
        order_number: orderNumber || null,
        payment_intent_id: paymentIntentId || null,
        paid: reconciliation?.paid || false,
        intent_status: reconciliation?.intentStatus || null,
        transaction_status: reconciliation?.transactionStatus || null,
        transaction_id: reconciliation?.transactionId || null,
      });

      if (orderNumber) {
        submission = await getSupportSubmission(orderNumber).catch((error) => {
          console.warn('[support-return] support submission lookup failed:', error?.message);
          return null;
        });
      }

      if (!reconciliation?.paid && orderNumber) {
        await notifyWebPushSupportPayment(orderNumber).catch((error) => {
          console.warn('[webpush-payment] return unsuccessful notification failed:', error?.message);
        });
      }

      if (reconciliation?.paid && orderNumber) {
        await notifySuccessfulSupportPayment(orderNumber).catch((error) => {
          console.warn('[payment-detail] return notification failed:', error?.message);
        });
        await notifyNtfySupportPayment(orderNumber).catch((error) => {
          console.warn('[ntfy-payment] return notification failed:', error?.message);
        });
      }

      // Whichever verified Bayarcash path first changes the order to PAID owns
      // the Telegram confirmation + testimonial prompt. The activation update is
      // idempotent, so callback/return races cannot create two testimonial flows.
      if (reconciliation?.result?.becamePaid && reconciliation?.result?.telegramUserId) {
        const amount = reconciliation?.result?.amount || reconciliation?.amount || '';
        const tier = submission?.tierLabel || reconciliation?.result?.tier?.label || '❤️ Supporter';

        await sendMessage(
          reconciliation.result.telegramUserId,
          [
            '❤️ Payment dah confirm ✅',
            amount ? `Support diterima: RM${amount}` : '',
            `Title 12 bulan: ${tier}`,
          ].filter(Boolean).join('\n'),
        ).catch((error) => console.warn('[support-return] Telegram confirmation failed:', error?.message));

        const activation = await activateSupportSubmissionAfterPayment(orderNumber).catch((error) => {
          console.warn('[support-return] testimonial activation failed:', error?.message);
          return null;
        });

        if (activation?.activated) {
          await sendMessage(
            reconciliation.result.telegramUserId,
            'Tinggalkan kata-kata support korang ❤️',
          ).catch((error) => console.warn('[support-return] testimonial follow-up failed:', error?.message));
        }
      }
    } catch (error) {
      lookupError = error;
      console.error('[support-return] Bayarcash reconciliation failed:', error?.code, error?.status, error?.message);
    }
  }

  const paid = Boolean(reconciliation?.paid);
  const status = reconciliation?.intentStatus
    || reconciliation?.transactionStatus
    || (lookupError ? 'lookup failed' : 'pending');
  const tierLabel = submission?.tierLabel
    || reconciliation?.result?.tier?.label
    || '❤️ Supporter';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(htmlPage({
    paid,
    status,
    orderNumber,
    paymentIntentId,
    tierLabel,
  }));
}
