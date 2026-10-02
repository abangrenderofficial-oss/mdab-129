import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import { setPaymentDetailGroup } from '../support/payment-detail.js';

async function isGroupAdmin(chatId, userId) {
  if (!chatId || !userId) return false;
  try {
    const member = await telegram('getChatMember', { chat_id: chatId, user_id: userId });
    return member?.status === 'creator' || member?.status === 'administrator';
  } catch {
    return false;
  }
}

export async function handleConnectPaymentDetailCommand(message = {}) {
  const chatId = message?.chat?.id;
  const chatType = message?.chat?.type;
  const userId = message?.from?.id;
  if (!chatId || !userId) return true;

  if (!['group', 'supergroup'].includes(chatType)) {
    await sendMessage(chatId, '❌ /connectpaymentdetail hanya boleh digunakan dalam group Telegram.').catch(() => {});
    return true;
  }
  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ /connectpaymentdetail hanya untuk admin bot.').catch(() => {});
    return true;
  }
  if (!(await isGroupAdmin(chatId, userId))) {
    await sendMessage(chatId, '❌ Admin bot mesti juga menjadi admin group ini untuk guna /connectpaymentdetail.').catch(() => {});
    return true;
  }

  try {
    await setPaymentDetailGroup(chatId, message?.chat?.title || '', userId);
    await sendMessage(chatId, [
      '✅ Payment Detail Group Connected',
      '',
      'Mulai sekarang setiap support payment yang berjaya akan dihantar ke group ini.',
      '',
      'Format ringkas notification: ID User - Amount - Successful ✅',
      'Detail akan sertakan ID user, nama, amount, type of support, date, time dan period tier 12 bulan.',
    ].join('\n'));
  } catch (error) {
    console.error('[connectpaymentdetail] failed:', error?.message);
    await sendMessage(chatId, '❌ Tak berjaya connect group payment detail sekarang. Cuba sekali lagi.').catch(() => {});
  }
  return true;
}