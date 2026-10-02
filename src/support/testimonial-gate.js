import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import {
  beginRejectedSupportResubmission,
  getActiveSupportSubmission,
  getRejectedSupportSubmission,
} from './submissions.js';

const PENDING_SUPPORT_COPY = 'untuk sambung guna bot tinggalkan kata2 support korang dulu ❤️';
const REVIEW_SUPPORT_COPY = 'Kata2 support korang masih dalam review. Tunggu admin approve dulu ya ❤️';
const REJECTED_SUPPORT_COPY = 'Kata2 support tadi di reject atas sbb tertentu. Please tinggalkan semula kata2 support nicely ❤️.';

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

async function rejectedPaidTestimonial(userId) {
  if (isResetAdmin(userId)) return null;
  return getRejectedSupportSubmission(userId).catch((error) => {
    console.warn('[support-testimonial-gate] rejected lookup failed:', error?.message);
    return null;
  });
}

async function rejectionGate(userId) {
  const rejected = await rejectedPaidTestimonial(userId);
  if (!rejected) return null;

  const reset = await beginRejectedSupportResubmission(rejected.orderNumber, userId).catch((error) => {
    console.warn('[support-testimonial-gate] rejected reset failed:', error?.message);
    return null;
  });
  return reset || rejected;
}

export async function enforceSupportTestimonialGateForMessage(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId || message?.chat?.type !== 'private') return false;
  if (!isUsageAttempt(message)) return false;

  const rejected = await rejectionGate(userId);
  if (rejected) {
    await sendMessage(chatId, REJECTED_SUPPORT_COPY).catch(() => {});
    return true;
  }

  const submission = await pendingPaidTestimonial(userId);
  if (!submission) return false;

  const copy = submission.state === 'REVIEW' ? REVIEW_SUPPORT_COPY : PENDING_SUPPORT_COPY;
  await sendMessage(chatId, copy).catch(() => {});
  return true;
}

export async function enforceSupportTestimonialGateForCallback(callbackQuery = {}) {
  const chatId = callbackQuery?.message?.chat?.id;
  const userId = callbackQuery?.from?.id;
  const chatType = callbackQuery?.message?.chat?.type;
  if (!chatId || !userId || chatType !== 'private') return false;

  const rejected = await rejectionGate(userId);
  if (rejected) {
    await telegram('answerCallbackQuery', {
      callback_query_id: callbackQuery?.id,
      text: REJECTED_SUPPORT_COPY,
      show_alert: true,
    }).catch(() => {});
    await sendMessage(chatId, REJECTED_SUPPORT_COPY).catch(() => {});
    return true;
  }

  const submission = await pendingPaidTestimonial(userId);
  if (!submission) return false;

  const copy = submission.state === 'REVIEW' ? REVIEW_SUPPORT_COPY : PENDING_SUPPORT_COPY;
  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery?.id,
    text: copy,
    show_alert: true,
  }).catch(() => {});
  await sendMessage(chatId, copy).catch(() => {});
  return true;
}
