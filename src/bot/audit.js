import { platformLabel } from '../platform.js';
import { isResetAdmin } from '../recovery.js';
import { getTelegramChat, sendMessage, telegram } from '../telegram.js';

const AUDIT_DELETE = 'audit:delete:v1';

function userFullName(from = {}) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || '-';
}

function formatAuditTime(unixSeconds) {
  const seconds = Number(unixSeconds || 0);
  if (!seconds) return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: false });
  return new Date(seconds * 1000).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: false });
}

function auditDeleteButton(profileMessageId = '') {
  const extra = Number(profileMessageId || 0) > 0 ? `|${Number(profileMessageId)}` : '';
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '🗑️ Deleted', callback_data: `${AUDIT_DELETE}${extra}` }]],
    },
  };
}

function buildAuditCaption(from = {}, audit = {}) {
  const username = from.username ? `@${from.username}` : '-';
  const platform = audit.platform ? platformLabel(audit.platform) : '-';
  return [
    '📋 USER RECORD',
    `👤 Username: ${username}`,
    `🆔 Telegram ID: ${from.id || '-'}`,
    `📝 Nama: ${userFullName(from)}`,
    `🕒 Masa: ${formatAuditTime(audit.sourceTimestamp)}`,
    `📱 Platform: ${platform}`,
  ].join('\n').slice(0, 1024);
}

async function latestProfilePhotoFileId(userId) {
  if (!userId) return '';
  try {
    const result = await telegram('getUserProfilePhotos', { user_id: userId, offset: 0, limit: 1 });
    const sizes = result?.photos?.[0];
    return Array.isArray(sizes) && sizes.length ? String(sizes.at(-1)?.file_id || '') : '';
  } catch (error) {
    console.warn('Profile photo lookup failed:', error?.code, error?.message);
    return '';
  }
}

async function requireMirrorGroup(mirrorGroupId) {
  const chat = await getTelegramChat(mirrorGroupId);
  if (!['group', 'supergroup'].includes(chat?.type)) {
    const error = new Error('Video monitoring destination must be a Telegram group or supergroup.');
    error.code = 'MIRROR_GROUP_REQUIRED';
    throw error;
  }
  if (String(chat.id || '') !== String(mirrorGroupId || '')) {
    const error = new Error('Video monitoring destination does not match the connected group.');
    error.code = 'MIRROR_GROUP_MISMATCH';
    throw error;
  }
  return chat;
}

async function mirrorVideoByFileId(mirrorGroupId, sentMessage, caption, profileMessageId) {
  const fileId = String(sentMessage?.video?.file_id || '');
  if (!fileId) return false;

  try {
    await telegram('sendVideo', {
      chat_id: mirrorGroupId,
      video: fileId,
      caption,
      supports_streaming: true,
      ...auditDeleteButton(profileMessageId),
    });
    return true;
  } catch (error) {
    console.warn('Group video mirror by file_id failed; falling back to copyMessage:', error?.code, error?.message);
    return false;
  }
}

export async function mirrorMediaToGroup(sourceChatId, sentMessage, mirrorGroupId, from, audit = {}) {
  if (!mirrorGroupId || !sentMessage?.message_id) return false;
  if (String(sourceChatId) === String(mirrorGroupId)) return false;

  try {
    await requireMirrorGroup(mirrorGroupId);
  } catch (error) {
    console.error('[video-monitor] blocked invalid destination:', error?.code, error?.message);
    return false;
  }

  const caption = buildAuditCaption(from, audit);
  const profilePhotoId = await latestProfilePhotoFileId(from?.id);
  let profileMessageId = 0;

  try {
    if (profilePhotoId) {
      const profileMessage = await telegram('sendPhoto', { chat_id: mirrorGroupId, photo: profilePhotoId });
      profileMessageId = Number(profileMessage?.message_id || 0);
    }

    if (sentMessage?.video?.file_id) {
      const mirrored = await mirrorVideoByFileId(mirrorGroupId, sentMessage, caption, profileMessageId);
      if (mirrored) return true;
    }

    await telegram('copyMessage', {
      chat_id: mirrorGroupId,
      from_chat_id: sourceChatId,
      message_id: sentMessage.message_id,
      caption,
      ...auditDeleteButton(profileMessageId),
    });
    return true;
  } catch (error) {
    if (profileMessageId) {
      await telegram('deleteMessage', { chat_id: mirrorGroupId, message_id: profileMessageId }).catch(() => {});
    }
    console.warn('Group mirror failed:', error?.code, error?.message);
    return false;
  }
}

async function isGroupAdmin(chatId, userId) {
  if (!chatId || !userId) return false;
  try {
    const member = await telegram('getChatMember', { chat_id: chatId, user_id: userId });
    return member?.status === 'creator' || member?.status === 'administrator';
  } catch {
    return false;
  }
}

export async function processAuditDelete(callbackQuery) {
  const action = String(callbackQuery?.data || '');
  if (!action.startsWith(AUDIT_DELETE)) return false;

  const chatId = callbackQuery?.message?.chat?.id;
  const messageId = callbackQuery?.message?.message_id;
  const userId = callbackQuery?.from?.id;
  const chatType = callbackQuery?.message?.chat?.type;
  if (!chatId || !messageId) return true;

  if (['group', 'supergroup'].includes(chatType) && !(await isGroupAdmin(chatId, userId))) {
    await telegram('answerCallbackQuery', {
      callback_query_id: callbackQuery.id,
      text: 'Hanya admin group boleh delete rekod ini.',
      show_alert: false,
    }).catch(() => {});
    return true;
  }

  const profileMessageId = Number(action.split('|')[1] || 0);
  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery.id,
    text: 'Rekod dipadam.',
    show_alert: false,
  }).catch(() => {});
  await telegram('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
  if (profileMessageId > 0 && profileMessageId !== Number(messageId)) {
    await telegram('deleteMessage', { chat_id: chatId, message_id: profileMessageId }).catch(() => {});
  }
  return true;
}

export async function setMirrorWebhook(baseUrl, mirrorGroupId = '', dropPendingUpdates = false) {
  if (!baseUrl) throw new Error('Public webhook base URL is unavailable.');
  if (mirrorGroupId) await requireMirrorGroup(mirrorGroupId);

  const endpoint = new URL(`${baseUrl}/api/telegram`);
  if (mirrorGroupId) endpoint.searchParams.set('mirror_group', String(mirrorGroupId));
  await telegram('setWebhook', {
    url: endpoint.toString(),
    ...(process.env.TELEGRAM_WEBHOOK_SECRET ? { secret_token: process.env.TELEGRAM_WEBHOOK_SECRET } : {}),
    allowed_updates: ['message', 'edited_message', 'callback_query'],
    drop_pending_updates: Boolean(dropPendingUpdates),
  });
}

export async function handleConnectCommand(message, baseUrl, disconnect = false) {
  const chatId = message?.chat?.id;
  const chatType = message?.chat?.type;
  const userId = message?.from?.id;

  if (!['group', 'supergroup'].includes(chatType)) {
    await sendMessage(chatId, '❌ /connect hanya boleh digunakan di dalam group Telegram.');
    return;
  }
  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ /connect dan /disconnect hanya untuk admin bot.');
    return;
  }
  if (!(await isGroupAdmin(chatId, userId))) {
    await sendMessage(chatId, '❌ Admin bot mesti juga menjadi admin group ini.');
    return;
  }

  try {
    await setMirrorWebhook(baseUrl, disconnect ? '' : chatId);
    await sendMessage(
      chatId,
      disconnect
        ? '✅ Group ini sudah disconnect daripada pemantauan video.'
        : '✅ Connected. Video pantauan hanya akan dihantar ke group ini. Channel Telegram tidak dibenarkan sebagai destination.',
    );
  } catch (error) {
    console.error('Connect webhook failed:', error?.message);
    await sendMessage(chatId, '❌ Tak berjaya connect group sekarang. Cuba sekali lagi.');
  }
}
