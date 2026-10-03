import { sendMessage } from '../telegram.js';

function malaysiaDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export async function notifyAffiliateCommission(affiliate = null) {
  if (!affiliate?.created || !affiliate?.referrerUserId) return { sent: false, reason: 'not_new' };

  const lines = [
    '🎉 Affiliate Commission!',
    '',
    `Referral anda buat payment RM${affiliate.grossAmount}.`,
    `Komisen +RM${affiliate.commissionAmount} (${affiliate.ratePercent}%)`,
    'Status: Pending',
    `Available: ${malaysiaDate(affiliate.availableAt)}`,
    '',
    'Taip /affiliate untuk tengok wallet.',
  ];

  await sendMessage(affiliate.referrerUserId, lines.join('\n'));
  return { sent: true };
}
