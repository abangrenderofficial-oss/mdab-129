import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import { getActiveSupportSubmission } from './submissions.js';

const PENDING_SUPPORT_COPY = 'untuk sambung guna bot tinggalkan kata2 support korang dulu ❤️';

function isUsageAttempt(message = {}) {
  if (Array.isArray(message?.photo) && message.photo.length) return true;
  if (message?.video?.file_id) return true;

  const text = String(message?.text || message?.caption || '').trim();
  if (!text) return false;
  if (/^\/luahrasa(?:@\w+)?(?:\s|$)/i.test(text)) return true;
  if (/^\/status(?:@\w+)?(?:\s|$)/i.test(text)) return true;
  return /https?:\/\/\S+/i.test(text);
}

async function pendingPaidTestimonial(userId) {
  if (isResetAdmin(userId)) return null;
  return getActiveSupportSubmission(userId).catch((error) => {
    console.warn('[support-testimonial-gate] lookup failed:', error?.message);
    return null;
  });
}

export async function enforceSupportTestimonialGateForMessage(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId || message?.chat?.type !== 'private') return false;
  if (!isUsageAttempt(message)) return false;

  const submission = await pendingPaidTestimonial(userId);
  if (!submission) return false;

  await sendMessage(chatId, PENDING_SUPPORT_COPY).catch(() => {});
  return true;
}

export async function enforceSupportTestimonialGateForCallback(callbackQuery = {}) {
  const chatId = callbackQuery?.message?.chat?.id;
  const userId = callbackQuery?.from?.id;
  const chatType = callbackQuery?.message?.chat?.type;
  if (!chatId || !userId || chatType !== 'private') return false;

  const submission = await pendingPaidTestimonial(userId);
  if (!submission) return false;

  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery?.id,
    text: PENDING_SUPPORT_COPY,
    show_alert: true,
  }).catch(() => {});
  await sendMessage(chatId, PENDING_SUPPORT_COPY).catch(() => {});
  return true;
}
