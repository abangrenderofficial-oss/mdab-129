import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import {
  lockAffiliateReferral,
  markAffiliateWithdrawal,
} from '../affiliate/store.js';

const AFFILIATE_WITHDRAW_ACTION = 'affiliate:withdraw';
const AFFILIATE_REFRESH_ACTION = 'affiliate:refresh';

let botUsernamePromise = null;

async function botUsername() {
  const configured = String(process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@+/, '');
  if (configured) return configured;

  if (!botUsernamePromise) {
    botUsernamePromise = telegram('getMe', {})
      .then((bot) => String(bot?.username || '').trim().replace(/^@+/, ''))
      .catch((error) => {
        botUsernamePromise = null;
        console.warn('[affiliate] getMe failed:', error?.message);
        return '';
      });
  }
  return botUsernamePromise;
}

function referralLink(username, code) {
  return username && code ? `https://t.me/${username}?start=ref_${code}` : '';
}

function affiliateWebUrl(context = {}) {
  const base = String(context?.baseUrl || process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  return base ? base + '/ar-payment/affiliate' : '';
}

async function sendAffiliateWebEntry(message = {}, context = {}, { withdraw = false } = {}) {
  const chatId = message?.chat?.id;
  const user = message?.from || {};
  if (!chatId || !user?.id) return true;

  if (message?.chat?.type !== 'private') {
    await sendMessage(chatId, '💰 Buka private chat bot untuk guna PayPing Affiliate.').catch(() => {});
    return true;
  }

  const url = affiliateWebUrl(context);
  const lines = [
    '💰 PayPing Affiliate',
    '',
    withdraw
      ? 'Withdrawal affiliate sekarang diurus melalui PayPing.'
      : 'Nak jadi affiliate MediaX dan dapat referral commission?',
    '',
    'Register / Login → Connect Telegram → Join Affiliate',
    'Lepas Join Affiliate, referral link peribadi akan dijana dalam PayPing.',
  ];

  const options = url
    ? {
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{
            text: withdraw ? '💸 Open PayPing Withdrawal' : '🔗 Open PayPing Affiliate',
            url,
          }]],
        },
      }
    : {};

  if (!url) {
    lines.push('', 'PayPing link belum tersedia. Cuba semula kejap lagi.');
  }

  await sendMessage(chatId, lines.join('\n'), options).catch(() => {});
  return true;
}

export async function handleAffiliateCommand(message = {}, context = {}) {
  return sendAffiliateWebEntry(message, context);
}

export async function handleAffiliateWithdrawCommand(message = {}, context = {}) {
  return sendAffiliateWebEntry(message, context, { withdraw: true });
}
export async function handleAffiliateStartPayload(message = {}, payload = '') {
  const user = message?.from || {};
  if (!user?.id || !String(payload || '').toLowerCase().startsWith('ref_')) return false;

  try {
    const result = await lockAffiliateReferral({
      userId: user.id,
      username: user.username || '',
      referralCode: payload,
    });
    console.log('[affiliate] referral start', {
      user_id: String(user.id),
      applied: Boolean(result?.applied),
      reason: result?.reason || null,
      referrer_user_id: result?.referrer?.userId || null,
    });
  } catch (error) {
    console.warn('[affiliate] referral lock failed:', error?.message);
  }
  return true;
}

export async function processAffiliateCallback(callbackQuery = {}, context = {}) {
  const action = String(callbackQuery?.data || '');
  if (![AFFILIATE_WITHDRAW_ACTION, AFFILIATE_REFRESH_ACTION].includes(action)) return false;

  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery?.id,
    text: 'Affiliate sekarang dibuka melalui PayPing.',
  }).catch(() => {});

  const chatId = callbackQuery?.message?.chat?.id;
  const messageId = callbackQuery?.message?.message_id;
  if (chatId && messageId) {
    await telegram('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
  }

  await sendAffiliateWebEntry({
    chat: callbackQuery?.message?.chat,
    from: callbackQuery?.from,
  }, context, { withdraw: action === AFFILIATE_WITHDRAW_ACTION });

  return true;
}
function payoutRequestId(message = {}) {
  return String(message?.text || '').trim().split(/\s+/)[1]?.trim().toUpperCase() || '';
}

export async function handleAffiliatePayoutCommand(message = {}, decision = 'PAID') {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return true;

  if (!isResetAdmin(userId) || message?.chat?.type !== 'private') {
    await sendMessage(chatId, '❌ Command ini hanya untuk owner dalam private chat.').catch(() => {});
    return true;
  }

  const requestId = payoutRequestId(message);
  if (!requestId) {
    await sendMessage(chatId, `Format: /${decision === 'PAID' ? 'affiliatepaid' : 'affiliatereject'} AW-XXXX`).catch(() => {});
    return true;
  }

  const result = await markAffiliateWithdrawal(requestId, decision);
  if (!result.updated) {
    await sendMessage(chatId, `❌ Request tak dikemaskini: ${result.reason || 'unknown'}`).catch(() => {});
    return true;
  }

  await sendMessage(chatId, [
    '✅ Affiliate withdrawal updated',
    `Request: ${result.requestId}`,
    `Amount: RM${result.amount}`,
    `Status: ${result.status}`,
  ].join('\n')).catch(() => {});

  if (result.userId) {
    await sendMessage(
      result.userId,
      result.status === 'PAID'
        ? `✅ PayPing Affiliate payout RM${result.amount} telah ditandakan PAID.\nRequest: ${result.requestId}`
        : `↩️ Withdrawal RM${result.amount} dibatalkan. Amount telah kembali ke Available wallet.\nRequest: ${result.requestId}`,
    ).catch(() => {});
  }
  return true;
}
