import { sendMessage, telegram } from '../telegram.js';
import { setQuoteFilterGroup } from '../support/quote-filter.js';

async function isGroupAdmin(chatId, userId) {
  if (!chatId || !userId) return false;
  try {
    const member = await telegram('getChatMember', { chat_id: chatId, user_id: userId });
    return member?.status === 'creator' || member?.status === 'administrator';
  } catch {
    return false;
  }
}

export async function handleConnectQuoteCommand(message = {}) {
  const chatId = message?.chat?.id;
  const chatType = message?.chat?.type;
  const userId = message?.from?.id;

  if (!chatId || !userId) return true;
  if (!['group', 'supergroup'].includes(chatType)) {
    await sendMessage(chatId, '❌ /connectquote hanya boleh digunakan dalam group Telegram.').catch(() => {});
    return true;
  }

  if (!(await isGroupAdmin(chatId, userId))) {
    await sendMessage(chatId, '❌ Hanya admin group boleh guna /connectquote.').catch(() => {});
    return true;
  }

  try {
    await setQuoteFilterGroup(chatId, message?.chat?.title || '');
    await sendMessage(
      chatId,
      [
        '✅ Quote Filter Connected',
        '',
        'Mulai sekarang:',
        '• Kata-kata support dari form payment',
        '• Luahan dari /luahrasa',
        '',
        'akan dihantar ke group ini untuk filter dahulu.',
        '',
        'Logik /connect untuk video tidak disentuh.',
      ].join('\n'),
    );
  } catch (error) {
    console.error('[connectquote] failed:', error?.message);
    await sendMessage(chatId, '❌ Tak berjaya connect group quote sekarang. Cuba sekali lagi.').catch(() => {});
  }

  return true;
}
