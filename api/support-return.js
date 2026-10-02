import { reconcileSupportPayment } from '../src/support/reconcile.js';
import { activateSupportSubmissionAfterPayment, getSupportSubmission, markSupportSubmissionAnnounced, restoreSupportSubmissionAwaitingName } from '../src/support/submissions.js';
import { saveSupportTestimonial } from '../src/support/community-store.js';
import { sendSupportQuoteToFilter } from '../src/support/quote-filter.js';
import { sendMessage } from '../src/telegram.js';

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

function cleanInput(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function htmlPage({
  paid,
  status,
  orderNumber,
  paymentIntentId,
  tierLabel,
  submission,
  notice = '',
  noticeType = 'ok',
  submittedName = '',
  submittedMessage = '',
}) {
  const alreadyShared = Boolean(submission?.announcedAt);
  const safeTier = escapeHtml(tierLabel || '❤️ Supporter');
  const safeOrder = escapeHtml(orderNumber || '');
  const safeIntent = escapeHtml(paymentIntentId || '');
  const safeStatus = escapeHtml(status || 'pending');
  const safeName = escapeHtml(submittedName || submission?.displayName || '');
  const safeMessage = escapeHtml(submittedMessage || submission?.supportMessage || '');

  const paidContent = `
    <div class="heart">❤️</div>
    <h1>Thank you, Payment Dah Confirm ✅</h1>
    <p class="lead">Tahniah! Selama sebulan ni awak dapat pegang title</p>
    <div class="tier">${safeTier}</div>

    ${notice ? `<div class="notice ${noticeType === 'error' ? 'error' : ''}">${escapeHtml(notice)}</div>` : ''}

    ${alreadyShared ? `
      <div class="done-box">
        <strong>Kata-kata support dah dihantar untuk filter ❤️</strong>
        <p>Terima kasih sebab support bot kita.</p>
      </div>
    ` : `
      <div class="section">
        <h2>Tinggalkan kata-kata support korang kat bawah ni</h2>
        <form method="post" action="/api/support-return">
          <input type="hidden" name="order" value="${safeOrder}">
          <input type="hidden" name="payment_intent_id" value="${safeIntent}">
          <label for="support_message">Kata-kata support</label>
          <textarea id="support_message" name="support_message" maxlength="500" required placeholder="Tulis kata-kata support korang...">${safeMessage}</textarea>
          <label for="display_name">Nama</label>
          <input id="display_name" name="display_name" type="text" maxlength="80" required placeholder="Nama yang korang nak paparkan" value="${safeName}">
          <button type="submit">Hantar ❤️</button>
        </form>
        <p class="small">Kata-kata support korang akan kita filter dulu sebelum di-share dalam channel ❤️.</p>
      </div>
    `}

    <div class="luah">
      <strong>💭 /luahrasa</strong>
      <p>Korang juga boleh command di bot <b>/luahrasa</b>. Korang boleh luah apa sahaja yang korang nak ahli channel baca, menumpang rasa sekali.</p>
      <p>Kalau korang ada title supporter yang masih aktif, title tu akan dipaparkan sekali tau! ✨</p>
    </div>
  `;

  const pendingContent = `
    <div class="heart">🔎</div>
    <h1>Payment sedang disemak</h1>
    <p class="lead">Return page diterima. Status payment akan disemak terus dengan Bayarcash.</p>
    ${orderNumber ? `<p class="meta">Support ID: ${safeOrder}</p>` : ''}
    ${paymentIntentId ? `<p class="meta">Payment Intent: ${safeIntent}</p>` : ''}
    <p class="meta">Bayarcash status: ${safeStatus}</p>
    <p>Boleh kembali ke Telegram dan tekan “Check Bayarcash” jika mahu semak sekali lagi.</p>
  `;

  return `<!doctype html>
<html lang="ms">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Support Bot</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0d0d0f;color:#fff;margin:0;min-height:100vh;padding:28px 18px}
    .wrap{width:100%;max-width:620px;margin:0 auto}
    .card{background:#1a1a1d;border:1px solid #343438;border-radius:24px;padding:28px;box-shadow:0 18px 60px rgba(0,0,0,.38)}
    .heart{font-size:48px;text-align:center;margin-bottom:12px}
    h1{font-size:30px;line-height:1.2;text-align:center;margin:0 0 14px}
    h2{font-size:20px;line-height:1.35;margin:0 0 16px}
    p{color:#d4d4d8;line-height:1.65;margin:8px 0}
    .lead{text-align:center;font-size:17px}
    .tier{margin:16px auto 26px;width:max-content;max-width:100%;padding:12px 18px;border-radius:999px;background:#28282d;border:1px solid #404047;font-weight:800;text-align:center;font-size:18px}
    .section,.luah,.done-box{margin-top:22px;padding:20px;background:#131316;border:1px solid #303036;border-radius:18px}
    .luah strong{font-size:19px}
    label{display:block;text-align:left;margin:14px 0 7px;color:#f4f4f5;font-weight:700}
    textarea,input{width:100%;border:1px solid #3b3b42;background:#0e0e11;color:#fff;border-radius:14px;padding:14px;font:inherit;outline:none}
    textarea{min-height:150px;resize:vertical}
    textarea:focus,input:focus{border-color:#6ee7c8;box-shadow:0 0 0 3px rgba(110,231,200,.12)}
    button{width:100%;margin-top:18px;border:0;border-radius:14px;padding:15px 18px;font:inherit;font-weight:800;background:#77d9c2;color:#09241d;cursor:pointer}
    .small{font-size:14px;text-align:center;margin-top:14px}
    .meta{font-size:14px;color:#aaa;word-break:break-word;text-align:center}
    .notice{margin:18px 0;padding:14px 16px;border-radius:14px;background:#173a31;border:1px solid #2b6f5d;color:#d8fff4;line-height:1.5}
    .notice.error{background:#401c22;border-color:#7b303c;color:#ffdce2}
    .done-box{text-align:center}
    .done-box strong{font-size:19px}
    b{color:#fff}
    @media(max-width:480px){.card{padding:22px 18px}h1{font-size:26px}}
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
  let notice = '';
  let noticeType = 'ok';
  const submittedName = cleanInput(source?.display_name, 80);
  const submittedMessage = cleanInput(source?.support_message, 500);

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

      if (reconciliation?.result?.becamePaid && reconciliation?.result?.telegramUserId) {
        const amount = reconciliation?.result?.amount || reconciliation?.amount || '';
        const tier = submission?.tierLabel || reconciliation?.result?.tier?.label || '❤️ Supporter';
        await sendMessage(
          reconciliation.result.telegramUserId,
          [
            '❤️ Payment dah confirm ✅',
            amount ? `Support diterima: RM${amount}` : '',
            `Title sebulan: ${tier}`,
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
  const status = reconciliation?.intentStatus || reconciliation?.transactionStatus || (lookupError ? 'lookup failed' : 'pending');
  const tierLabel = submission?.tierLabel || reconciliation?.result?.tier?.label || '❤️ Supporter';

  if (req.method === 'POST' && paid) {
    if (!submission) {
      notice = 'Payment dah confirmed, tapi rekod supporter tak dijumpai. Kata-kata belum dihantar.';
      noticeType = 'error';
    } else if (submission.announcedAt) {
      notice = 'Kata-kata support ni dah dihantar untuk filter sebelum ni ❤️';
    } else if (!submittedMessage || !submittedName) {
      notice = 'Isi kata-kata support dan nama dulu ya.';
      noticeType = 'error';
    } else {
      try {
        const saved = await saveSupportTestimonial(orderNumber, submittedMessage, submittedName);
        await sendSupportQuoteToFilter({
          displayName: saved?.displayName || submittedName,
          supportMessage: saved?.supportMessage || submittedMessage,
          tierLabel: saved?.tierLabel || tierLabel,
          orderNumber: saved?.orderNumber || orderNumber,
          userId: saved?.telegramUserId || submission?.telegramUserId || '',
        });
        submission = await markSupportSubmissionAnnounced(orderNumber);
        notice = 'Terima kasih! Kata-kata support korang kita akan filter dulu. If everything okay, kita akan share dalam channel ❤️';
      } catch (error) {
        console.error('[support-return] quote filter delivery failed:', error?.code, error?.message);
        await restoreSupportSubmissionAwaitingName(orderNumber, submission?.telegramUserId).catch(() => {});
        notice = error?.code === 'QUOTE_FILTER_NOT_CONNECTED'
          ? 'Group filter belum disambungkan lagi. Admin perlu guna /connectquote dahulu.'
          : 'Payment dah confirmed, tapi kata-kata support belum berjaya dihantar untuk filter. Cuba tekan hantar sekali lagi.';
        noticeType = 'error';
        submission = await getSupportSubmission(orderNumber).catch(() => submission);
      }
    }
  } else if (req.method === 'POST' && !paid) {
    notice = 'Payment belum disahkan paid oleh Bayarcash, jadi borang belum dihantar.';
    noticeType = 'error';
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(htmlPage({
    paid,
    status,
    orderNumber,
    paymentIntentId,
    tierLabel,
    submission,
    notice,
    noticeType,
    submittedName,
    submittedMessage,
  }));
}
