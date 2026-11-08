import { getTelegramChat, sendMessage, telegram } from '../telegram.js';
import { isResetAdmin } from '../recovery.js';
import {
  setQuoteAdminGroup, disconnectQuoteAdminGroup, deliverPendingQuoteAdminSubmissions,
} from '../support/quote-admin.js';

async function isGroupAdmin(chatId, userId) {
  if (!chatId || !userId) return false;
  try {
    const member = await telegram('getChatMember', { chat_id: chatId, user_id: userId });
    return member?.status === 'creator' || member?.status === 'administrator';
  } catch {
    return false;
  }
}

async function authorized(message) {
  const chatId = message?.chat?.id;
  if (!chatId || !['group', 'supergroup'].includes(message?.chat?.type)) {
    if (chatId) await sendMessage(chatId, '❌ Run this command inside your private Quote Admin group.').catch(() => {});
    return false;
  }
  if (!isResetAdmin(message?.from?.id)) {
    await sendMessage(chatId, '❌ Only the MediaX bot owner can manage the private Quote Admin group.').catch(() => {});
    return false;
  }
  if (!await isGroupAdmin(chatId, message.from.id)) {
    await sendMessage(chatId, '❌ Bot owner must also be an admin of this group.').catch(() => {});
    return false;
  }
  return true;
}

export async function handleConnectQuoteAdminCommand(message = {}) {
  if (!await authorized(message)) return true;
  const chatId = message.chat.id;
  try {
    const chat = await getTelegramChat(chatId);
    if (chat.username) throw new Error('This group is public. Remove the public @username first.');
    await setQuoteAdminGroup(chatId, message?.chat?.title || '');
    const pending = await deliverPendingQuoteAdminSubmissions({ limit: 20 });
    await sendMessage(chatId, [
      '🔒 Quote Admin Database Connected ✅',
      '',
      'From now on, both Luah Rasa and supporter messages will have a separate private copy here:',
      '• Telegram ID and @username',
      '• Telegram profile name + submitted display name',
      '• Active supporter status / tier',
      '• Original message and submission number',
      '',
      'The /connectquote filter remains unchanged with Approve / Reject buttons.',
      `Queued private records delivered: ${pending.delivered || 0}`,
      '',
      '⚠️ Only add trusted admins. Personal details must not be shared publicly.',
      'Use /disconnectquoteadmin here to stop sending private records.',
    ].join('\n'));
  } catch (error) {
    console.warn('[quote-admin] connection failed:', error?.message);
    await sendMessage(chatId, `❌ Could not connect Quote Admin Database: ${String(error?.message || 'unknown error').slice(0, 210)}`).catch(() => {});
  }
  return true;
}

export async function handleDisconnectQuoteAdminCommand(message = {}) {
  if (!await authorized(message)) return true;
  const chatId = message.chat.id;
  try {
    const disconnected = await disconnectQuoteAdminGroup(chatId);
    await sendMessage(chatId, disconnected
      ? '✅ Quote Admin Database disconnected. New private records will stay pending until a private admin group is connected again.'
      : '⚠️ This is not the configured Quote Admin Database group.');
  } catch (error) {
    console.warn('[quote-admin] disconnect failed:', error?.message);
    await sendMessage(chatId, '❌ Could not disconnect private Quote Admin group.').catch(() => {});
  }
  return true;
}
