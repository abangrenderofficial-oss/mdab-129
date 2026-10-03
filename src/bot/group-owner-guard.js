import { extractFirstUrl } from '../platform.js';
import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';

function isGroupChat(chatType = '') {
  return chatType === 'group' || chatType === 'supergroup';
}

function looksLikeGroupBotUse(message = {}) {
  const text = String(message?.text || message?.caption || '').trim();
  const firstToken = text.split(/\s+/)[0] || '';
  if (firstToken.startsWith('/')) return true;
  if (extractFirstUrl(text)) return true;
  return Boolean(
    message?.video
    || message?.photo
    || message?.document
    || message?.audio
    || message?.voice
    || message?.animation,
  );
}

export async function rejectNonOwnerGroupMessage(message = {}) {
  if (!isGroupChat(message?.chat?.type)) return false;
  const userId = message?.from?.id;
  if (!userId || isResetAdmin(userId)) return false;
  if (!looksLikeGroupBotUse(message)) return false;

  await sendMessage(
    message.chat.id,
    '❌ Bot ini tidak boleh digunakan dalam group. Sila guna private chat bot.',
  ).catch(() => {});
  return true;
}

export async function rejectNonOwnerGroupCallback(callbackQuery = {}) {
  if (!isGroupChat(callbackQuery?.message?.chat?.type)) return false;
  const userId = callbackQuery?.from?.id;
  if (!userId || isResetAdmin(userId)) return false;

  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery.id,
    text: 'Hanya owner bot boleh guna fungsi bot dalam group.',
    show_alert: true,
  }).catch(() => {});
  return true;
}
