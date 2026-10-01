import { sendMessage } from '../telegram.js';
import { getActiveSupporterTitle } from '../support/community-store.js';
import { publishLuahRasa } from '../support/community.js';

function commandBody(message = {}) {
  const text = String(message?.text || message?.caption || '').trim();
  const firstSpace = text.indexOf(' ');
  return firstSpace >= 0 ? text.slice(firstSpace + 1).trim() : '';
}

export async function handleLuahRasaCommand(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return true;

  if (message?.chat?.type && message.chat.type !== 'private') {
    await sendMessage(chatId, '💭 Guna /luahrasa dalam private chat dengan bot ya.').catch(() => {});
    return true;
  }

  let supporter = null;
  try {
    supporter = await getActiveSupporterTitle(userId);
  } catch (error) {
    console.warn('[luahrasa] supporter title lookup failed:', error?.message);
    await sendMessage(chatId, 'Tak dapat semak title Supporter sekarang. Cuba lagi kejap.').catch(() => {});
    return true;
  }

  if (!supporter) {
    await sendMessage(
      chatId,
      [
        '💭 /luahrasa khas untuk Supporter yang title masih aktif.',
        '',
        'Lepas payment support confirmed, title Supporter aktif selama sebulan.',
      ].join('\n'),
    ).catch(() => {});
    return true;
  }

  const body = commandBody(message);
  if (!body) {
    await sendMessage(
      chatId,
      [
        '💭 Luah Rasa',
        '',
        `Title awak: ${supporter.tierLabel}`,
        '',
        'Tulis luahan dalam mesej yang sama macam ni:',
        '/luahrasa Aku nak cakap sesuatu yang aku pendam lama...',
        '',
        'Luahan akan dipaparkan dalam channel bersama title Supporter awak ✨',
      ].join('\n'),
    ).catch(() => {});
    return true;
  }

  const messageText = body.slice(0, 1200);
  try {
    await publishLuahRasa({
      message: messageText,
      tierLabel: supporter.tierLabel,
    });
    await sendMessage(
      chatId,
      `Dah share dalam channel ❤️\n\n${supporter.tierLabel} turut dipaparkan sekali ✨`,
    );
  } catch (error) {
    console.warn('[luahrasa] channel publish failed:', error?.message);
    await sendMessage(
      chatId,
      'Luahan belum berjaya dihantar ke channel. Cuba lagi kejap.',
    ).catch(() => {});
  }

  return true;
}
