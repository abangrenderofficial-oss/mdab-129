// What happens after a support payment is verified, whichever way it was verified:
// the Bayarcash callback, or a paid event handed over by PayPing (CHIP / Bayarcash via PayPing).
import { getSupportSubmission, activateSupportSubmissionAfterPayment, ensurePaidSupportSubmission } from './submissions.js';
import { sendMessage } from '../telegram.js';
import { notifySuccessfulSupportPayment } from './payment-detail.js';
import { notifyWebPushSupportPayment } from './webpush-payment.js';
import { notifyNtfySupportPayment } from './ntfy-payment.js';
import { notifyAffiliateCommission } from '../affiliate/notify.js';
import { refreshSupportMonitorMessage } from './monitor-publisher.js';

export function confirmationText(result, submission = null, { sandbox = false } = {}) {
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

export async function afterSupportTransaction(result, { sandbox = false } = {}) {
  if (result?.affiliate?.created) {
    await notifyAffiliateCommission(result.affiliate).catch((error) => {
      console.warn('[affiliate] callback commission notification failed:', error?.message);
    });
  }

  let submission = null;
  let promptForSupportMessage = false;
  if (result?.paid && result?.orderNumber) {
    // A PayPing checkout writes the verified PAID support order directly.
    // The old Bayarcash flow already created the submission at checkout.
    // This works for both, and a replay never asks for a second testimonial.
    const ensured = await ensurePaidSupportSubmission(result.orderNumber);
    submission = ensured.submission;
    const activation = await activateSupportSubmissionAfterPayment(result.orderNumber);
    promptForSupportMessage = Boolean(ensured.created || activation?.activated);
  } else if (result?.orderNumber) {
    submission = await getSupportSubmission(result.orderNumber).catch((error) => {
      console.warn('[bayarcash] support submission lookup failed:', error?.message);
      return null;
    });
  }

  if (result?.knownOrder && result?.orderNumber && !result?.paid) {
    await notifyWebPushSupportPayment(result.orderNumber).catch((error) => {
      console.warn('[webpush-payment] unsuccessful callback notification failed:', error?.message);
    });
  }

  if (result?.paid && result?.orderNumber) {
    await notifySuccessfulSupportPayment(result.orderNumber).catch((error) => {
      console.warn('[payment-detail] notification failed:', error?.message);
    });
    await notifyNtfySupportPayment(result.orderNumber).catch((error) => {
      console.warn('[ntfy-payment] callback notification failed:', error?.message);
    });
    await refreshSupportMonitorMessage().catch((error) => {
      console.warn('[support-monitor] refresh after paid support failed:', error?.message);
    });
  }

  if (result?.becamePaid && result?.telegramUserId) {
    await sendMessage(result.telegramUserId, confirmationText(result, submission, { sandbox })).catch((error) => {
      console.warn('[bayarcash] Telegram confirmation failed:', error?.message);
    });

  }

  if (result?.paid && promptForSupportMessage && submission?.telegramUserId) {
    await sendMessage(
      submission.telegramUserId,
      'Tinggalkan kata-kata support korang ❤️',
    ).catch((error) => {
      console.warn('[support] testimonial follow-up failed:', error?.message);
    });
  }

}
