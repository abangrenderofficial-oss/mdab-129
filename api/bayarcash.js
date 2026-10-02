import { isBayarcashConfigured, isBayarcashSandbox, verifyTransactionCallback } from '../src/payments/bayarcash.js';
import { applyBayarcashTransaction } from '../src/support/store.js';
import { activateSupportSubmissionAfterPayment, getSupportSubmission } from '../src/support/submissions.js';
import { sendMessage } from '../src/telegram.js';
import { notifySuccessfulSupportPayment } from '../src/support/payment-detail.js';

function json(res, status, body) {
  res.status(status).json(body);
}

function confirmationText(result, submission = null) {
  const sandbox = isBayarcashSandbox();
  const lines = [];
  if (sandbox) lines.push('🧪 SANDBOX TEST', '');
  lines.push(
    `❤️ Support diterima — RM${result.amount}`,
    '',
    sandbox
      ? 'Payment test berjaya direkodkan. Tiada duit sebenar digunakan.'
      : 'Terima kasih banyak-banyak sebab support bot kita 🥹❤️',
    `Support ID: ${result.orderNumber}`,
    `Jumlah support: RM${result.totalSupport}`,
  );
  const tierLabel = submission?.tierLabel || result?.tier?.label;
  if (tierLabel) lines.push(`Status: ${tierLabel}`, 'Tempoh title: 12 bulan');
  return lines.join('\n');
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

  let submission = null;
  if (result?.orderNumber) {
    submission = await getSupportSubmission(result.orderNumber).catch((error) => {
      console.warn('[bayarcash] support submission lookup failed:', error?.message);
      return null;
    });
  }

  if (result?.paid && result?.orderNumber) {
    await notifySuccessfulSupportPayment(result.orderNumber).catch((error) => {
      console.warn('[payment-detail] notification failed:', error?.message);
    });
  }

  if (result?.becamePaid && result?.telegramUserId) {
    await sendMessage(result.telegramUserId, confirmationText(result, submission)).catch((error) => {
      console.warn('[bayarcash] Telegram confirmation failed:', error?.message);
    });

    const activation = await activateSupportSubmissionAfterPayment(result.orderNumber).catch((error) => {
      console.warn('[bayarcash] testimonial activation failed:', error?.message);
      return null;
    });
    if (activation?.activated) {
      await sendMessage(
        result.telegramUserId,
        'Tinggalkan kata-kata support korang ❤️',
      ).catch((error) => {
        console.warn('[bayarcash] testimonial follow-up failed:', error?.message);
      });
    }
  }

  // Support testimonial/feedback publishing is intentionally disabled for now.
  return json(res, 200, { ok: true });
}
