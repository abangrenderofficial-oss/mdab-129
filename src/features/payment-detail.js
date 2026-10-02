import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import { getPaymentDetailGroup, setPaymentDetailGroup } from '../support/payment-detail.js';

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

export async function handlePaymentDetailTestCommand(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return true;

  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ /testpaymentdetail hanya untuk admin bot.').catch(() => {});
    return true;
  }

  if (message?.chat?.type !== 'private') {
    await sendMessage(chatId, '❌ /testpaymentdetail hanya boleh digunakan dalam private chat bot.').catch(() => {});
    return true;
  }

  try {
    const target = await getPaymentDetailGroup();
    if (!target?.groupId) {
      await sendMessage(chatId, '❌ Belum ada group /connectpaymentdetail.').catch(() => {});
      return true;
    }

    const sent = await sendMessage(
      target.groupId,
      [
        'ID 123456789 - RM10.00 - Successful ✅',
        '',
        'ID user - 123456789',
        'Nama - Test User',
        'Amount - RM10.00',
        'Type of support - 🤍 Supporter',
        'Date - 3 Oct 2026',
        'Time - 12:15:32 AM',
        'Period - 3 Oct 2026 sampai 3 Oct 2027 (12 bulan)',
        '',
        'TEST ONLY — notification preview check',
      ].join('\n'),
    );

    await sendMessage(
      chatId,
      `✅ Test notification dah dihantar ke group payment detail. Message ID: ${sent?.message_id || '-'}`,
    ).catch(() => {});
  } catch (error) {
    console.error('[testpaymentdetail] failed:', error?.message);
    await sendMessage(chatId, '❌ Test notification gagal dihantar.').catch(() => {});
  }

  return true;
}
