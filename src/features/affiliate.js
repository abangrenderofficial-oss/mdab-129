import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import {
  createAffiliateWithdrawal,
  getAffiliateDashboard,
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

function dashboardText(data, link) {
  return [
    '💰 PayPing Affiliate',
    '',
    `Available: RM${data.available}`,
    `Pending: RM${data.pending}`,
    `Withdrawing: RM${data.withdrawing}`,
    `Total Earned: RM${data.totalEarned}`,
    '',
    `👥 Referrals: ${data.referrals}`,
    `💳 Paying Referrals: ${data.payingReferrals}`,
    `Commission: ${data.commissionPercent}%`,
    `Hold: ${data.holdDays} hari`,
    `Minimum Withdraw: RM${data.minimumWithdrawal}`,
    '',
    '🔗 Referral Link',
    link || 'Referral link belum dapat dijana.',
    '',
    '1 user hanya boleh dikaitkan dengan 1 referrer. Referral yang pertama berjaya akan kekal locked.',
  ].join('\n');
}

function dashboardKeyboard(data, link) {
  const rows = [];
  if (link) {
    const shareText = encodeURIComponent('Guna PayPing melalui link saya 👇');
    rows.push([{
      text: '📤 Share Referral Link',
      url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${shareText}`,
    }]);
  }
  rows.push([{ text: `💸 Withdraw RM${data.available}`, callback_data: AFFILIATE_WITHDRAW_ACTION }]);
  rows.push([{ text: '🔄 Refresh', callback_data: AFFILIATE_REFRESH_ACTION }]);
  return { inline_keyboard: rows };
}

async function sendAffiliateDashboard(message = {}) {
  const chatId = message?.chat?.id;
  const user = message?.from || {};
  if (!chatId || !user?.id) return true;

  if (message?.chat?.type !== 'private') {
    await sendMessage(chatId, '💰 Buka private chat bot untuk guna PayPing Affiliate.').catch(() => {});
    return true;
  }

  const data = await getAffiliateDashboard({
    userId: user.id,
    username: user.username || '',
  });
  const username = await botUsername();
  const link = referralLink(username, data.profile.referralCode);

  await sendMessage(chatId, dashboardText(data, link), {
    disable_web_page_preview: true,
    reply_markup: dashboardKeyboard(data, link),
  });
  return true;
}

async function notifyOwnerWithdrawal(withdrawal) {
  const ownerId = Number(process.env.BOT_OWNER_ID || 0);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) return;

  const username = withdrawal.username ? `@${withdrawal.username}` : '-';
  await sendMessage(ownerId, [
    '💸 PAYPING AFFILIATE WITHDRAWAL',
    '',
    `Request: ${withdrawal.requestId}`,
    `User: ${username}`,
    `Telegram ID: ${withdrawal.userId}`,
    `Amount: RM${withdrawal.amount}`,
    '',
    'Selepas transfer manual:',
    `/affiliatepaid ${withdrawal.requestId}`,
    '',
    'Kalau request perlu dibatalkan:',
    `/affiliatereject ${withdrawal.requestId}`,
  ].join('\n')).catch((error) => {
    console.warn('[affiliate] owner withdrawal notification failed:', error?.message);
  });
}

async function requestWithdrawal(message = {}) {
  const chatId = message?.chat?.id;
  const user = message?.from || {};
  if (!chatId || !user?.id) return true;

  if (message?.chat?.type !== 'private') {
    await sendMessage(chatId, '💸 Withdrawal hanya boleh dibuat dalam private chat bot.').catch(() => {});
    return true;
  }

  const result = await createAffiliateWithdrawal({
    userId: user.id,
    username: user.username || '',
  });

  if (!result.created) {
    if (result.reason === 'payout_profile_required') {
      await sendMessage(
        chatId,
        '💳 Set payout details dulu dalam PayPing! → Affiliate → Payout Method. Selepas save DuitNow/bank details, cuba Withdraw semula.',
      ).catch(() => {});
      return true;
    }

    await sendMessage(
      chatId,
      `Belum cukup minimum withdrawal.\n\nAvailable: RM${result.available}\nMinimum: RM${result.minimum}`,
    ).catch(() => {});
    return true;
  }

  await sendMessage(chatId, [
    '✅ Withdrawal request diterima',
    '',
    `Request: ${result.requestId}`,
    `Amount: RM${result.amount}`,
    'Status: Pending',
    '',
    'Admin akan urus payout secara manual. Commission ini dah dikunci supaya tak boleh withdraw dua kali.',
  ].join('\n')).catch(() => {});

  await notifyOwnerWithdrawal(result);
  return true;
}

export async function handleAffiliateCommand(message = {}) {
  try {
    return await sendAffiliateDashboard(message);
  } catch (error) {
    console.error('[affiliate] dashboard failed:', error?.message);
    await sendMessage(message?.chat?.id, '❌ Affiliate wallet belum dapat dibuka. Cuba lagi kejap lagi.').catch(() => {});
    return true;
  }
}

export async function handleAffiliateWithdrawCommand(message = {}) {
  try {
    return await requestWithdrawal(message);
  } catch (error) {
    console.error('[affiliate] withdrawal failed:', error?.message);
    await sendMessage(message?.chat?.id, '❌ Withdrawal belum dapat dibuat. Cuba lagi kejap lagi.').catch(() => {});
    return true;
  }
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

export async function processAffiliateCallback(callbackQuery = {}) {
  const action = String(callbackQuery?.data || '');
  if (![AFFILIATE_WITHDRAW_ACTION, AFFILIATE_REFRESH_ACTION].includes(action)) return false;

  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery?.id,
    text: action === AFFILIATE_WITHDRAW_ACTION ? 'Semak wallet…' : 'Refreshing…',
  }).catch(() => {});

  const message = {
    chat: callbackQuery?.message?.chat,
    from: callbackQuery?.from,
  };

  if (action === AFFILIATE_WITHDRAW_ACTION) {
    await requestWithdrawal(message);
    return true;
  }

  await sendAffiliateDashboard(message);
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
