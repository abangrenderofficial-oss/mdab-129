import { sendMessage, telegram } from '../telegram.js';
import { isResetAdmin } from '../recovery.js';
import {
  getQuoteModeration,
  moderateQuote,
  setQuoteFilterGroup,
} from '../support/quote-filter.js';
import { deliverApprovedModeration } from '../support/content-bridge.js';
import { markSupportSubmissionApproved, markSupportSubmissionRejected } from '../support/submissions.js';

async function isGroupAdmin(chatId, userId) {
  if (!chatId || !userId) return false;
  try {
    const member = await telegram('getChatMember', { chat_id: chatId, user_id: userId });
    return member?.status === 'creator' || member?.status === 'administrator';
  } catch {
    return false;
  }
}

async function answerCallback(callbackQuery, text = '', showAlert = false) {
  if (!callbackQuery?.id) return;
  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery.id,
    ...(text ? { text } : {}),
    show_alert: Boolean(showAlert),
  }).catch(() => {});
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

  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ /connectquote hanya untuk admin bot.').catch(() => {});
    return true;
  }

  if (!(await isGroupAdmin(chatId, userId))) {
    await sendMessage(chatId, '❌ Admin bot mesti juga menjadi admin group ini untuk guna /connectquote.').catch(() => {});
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
        '• Kata-kata support dari private bot selepas payment',
        '• Luahan dari /luahrasa',
        '',
        'akan dihantar ke group ini untuk filter dahulu.',
        '',
        'Setiap submission akan ada button ✅ Approve / ❌ Reject.',
        'Destination ini wajib group/supergroup — channel tidak dibenarkan.',
        'Logik /connect untuk video tidak disentuh.',
      ].join('\n'),
    );
  } catch (error) {
    console.error('[connectquote] failed:', error?.message);
    await sendMessage(chatId, '❌ Tak berjaya connect group quote sekarang. Cuba sekali lagi.').catch(() => {});
  }

  return true;
}

export async function processQuoteFilterCallback(callbackQuery = {}) {
  const action = String(callbackQuery?.data || '');
  const match = action.match(/^quote:(approve|reject):(\d+)$/);
  if (!match) return false;

  const decision = match[1] === 'approve' ? 'APPROVED' : 'REJECTED';
  const moderationId = Number(match[2]);
  const chatId = callbackQuery?.message?.chat?.id;
  const chatType = callbackQuery?.message?.chat?.type;
  const messageId = callbackQuery?.message?.message_id;
  const userId = callbackQuery?.from?.id;

  if (!chatId || !messageId || !userId || !['group', 'supergroup'].includes(chatType)) {
    await answerCallback(callbackQuery, 'Button ini hanya boleh digunakan dalam group filter.', true);
    return true;
  }

  if (!isResetAdmin(userId)) {
    await answerCallback(callbackQuery, 'Hanya owner bot boleh Approve / Reject.', true);
    return true;
  }

  if (!(await isGroupAdmin(chatId, userId))) {
    await answerCallback(callbackQuery, 'Owner bot mesti juga menjadi admin group ini.', true);
    return true;
  }

  try {
    const existing = await getQuoteModeration(moderationId);
    if (!existing) {
      await answerCallback(callbackQuery, 'Submission ini tak dijumpai.', true);
      return true;
    }

    if (existing.filterChatId && String(existing.filterChatId) !== String(chatId)) {
      await answerCallback(callbackQuery, 'Submission ini bukan milik group filter ini.', true);
      return true;
    }

    let finalRecord = existing;
    if (existing.status === 'PENDING') {
      finalRecord = await moderateQuote(moderationId, decision, userId) || existing;
    }

    const finalStatus = String(finalRecord?.status || existing.status || '');
    const approved = finalStatus === 'APPROVED';
    const rejected = finalStatus === 'REJECTED';
    const statusLine = approved
      ? '✅ APPROVED'
      : rejected
        ? '❌ REJECTED'
        : `⚠️ ${finalStatus || 'UNKNOWN'}`;

    const originalText = String(callbackQuery?.message?.text || '').replace(/\n\n(?:✅ APPROVED|❌ REJECTED|⚠️ [^\n]+)\s*$/u, '');
    await telegram('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `${originalText}\n\n${statusLine}`,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [] },
    }).catch((error) => {
      if (!String(error?.message || '').includes('message is not modified')) throw error;
    });

    if (finalStatus !== decision) {
      await answerCallback(
        callbackQuery,
        finalStatus === 'APPROVED' ? 'Submission ni dah di-Approve.' : 'Submission ni dah di-Reject.',
        true,
      );
      return true;
    }

    await answerCallback(
      callbackQuery,
      approved ? 'Approved ✅' : 'Rejected ❌',
    );

    if (approved) {
      if (String(finalRecord?.kind || '') === 'SUPPORT') {
        const unlocked = await markSupportSubmissionApproved({
          orderNumber: finalRecord?.sourceOrderNumber || '',
          userId: finalRecord?.telegramUserId || '',
          supportMessage: finalRecord?.body || '',
          displayName: finalRecord?.displayName || '',
          tierLabel: finalRecord?.tierLabel || '',
        }).catch((error) => {
          console.error('[quote-filter] supporter unlock failed:', error?.message);
          return null;
        });

        if (!unlocked) {
          console.error('[quote-filter] supporter unlock failed: submission_not_found');
        }
      }

      void deliverApprovedModeration(finalRecord).catch((error) => {
        console.error('[quote-filter] approved delivery failed:', error?.message);
      });
    } else if (rejected && String(finalRecord?.kind || '') === 'SUPPORT') {
      await markSupportSubmissionRejected({
        orderNumber: finalRecord?.sourceOrderNumber || '',
        userId: finalRecord?.telegramUserId || '',
        supportMessage: finalRecord?.body || '',
        displayName: finalRecord?.displayName || '',
        tierLabel: finalRecord?.tierLabel || '',
      }).catch((error) => {
        console.error('[quote-filter] supporter relock failed:', error?.message);
      });
    }
  } catch (error) {
    console.error('[quote-filter] moderation callback failed:', error?.message);
    await answerCallback(callbackQuery, 'Tak berjaya update filter sekarang. Cuba lagi.', true);
  }

  return true;
}
