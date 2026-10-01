import { sendMessage } from '../telegram.js';
import { getActiveSupporterTitle } from '../support/community-store.js';
import {
  clearLuahRasaSession,
  getLuahRasaSession,
  setLuahRasaMessage,
  startLuahRasaSession,
} from '../support/luahrasa-store.js';
import { sendLuahRasaToFilter } from '../support/quote-filter.js';

function cleanText(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
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
  }

  const tierLabel = supporter?.tierLabel || '';

  try {
    await startLuahRasaSession(userId, tierLabel);
  } catch (error) {
    console.warn('[luahrasa] start session failed:', error?.message);
    await sendMessage(chatId, 'Luah rasa belum dapat dimulakan sekarang. Cuba lagi kejap.').catch(() => {});
    return true;
  }

  await sendMessage(
    chatId,
    [
      tierLabel ? `Hi, ${tierLabel}!` : 'Hi!',
      '',
      'Awak ada apa2 nak luah dalam channel?',
      'Boleh share ttg :',
      'i.Perasaan 🤍',
      'ii.Pengalaman kisah hidup korang seram/happy/sedih/kecewa 😇',
      'iii.Nasihat/Tips anything✍🏻',
      '',
      'apa2 ja semua boleh ✨',
      '',
      'Tulis sekarang & Send di sini tau!',
    ].join('\n'),
  ).catch(() => {});

  return true;
}

export async function processLuahRasaMessage(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  const chatType = message?.chat?.type;
  if (!chatId || !userId || chatType !== 'private') return false;

  const rawText = String(message?.text || message?.caption || '').trim();
  if (rawText.startsWith('/')) return false;

  let session = null;
  try {
    session = await getLuahRasaSession(userId);
  } catch (error) {
    console.warn('[luahrasa] session lookup failed:', error?.message);
    return false;
  }
  if (!session) return false;

  if (session.state === 'AWAITING_MESSAGE') {
    const luahan = cleanText(rawText, 1500);
    if (!luahan) {
      await sendMessage(chatId, 'Send luahan dalam bentuk text ya.').catch(() => {});
      return true;
    }

    await setLuahRasaMessage(userId, luahan);
    await sendMessage(chatId, 'Boleh saya tahu nama awak?').catch(() => {});
    return true;
  }

  if (session.state === 'AWAITING_NAME') {
    const displayName = cleanText(rawText, 80);
    if (!displayName) {
      await sendMessage(chatId, 'Isi nama yang awak nak kita paparkan ya.').catch(() => {});
      return true;
    }

    try {
      await sendLuahRasaToFilter({
        message: session.luahan,
        displayName,
        tierLabel: session.tierLabel,
      });
      await clearLuahRasaSession(userId);
      await sendMessage(
        chatId,
        'Terima kasih! luahan awak kita akan filter dulu. If everything okay, kita akan share luahan awak di channel ✨.',
      );
    } catch (error) {
      console.warn('[luahrasa] filter delivery failed:', error?.code, error?.message);
      await sendMessage(
        chatId,
        error?.code === 'QUOTE_FILTER_NOT_CONNECTED'
          ? 'Luahan awak dah siap, tapi group filter belum disambungkan lagi. Cuba semula kejap lagi ya.'
          : 'Luahan awak belum berjaya dihantar untuk filter. Cuba hantar nama sekali lagi kejap lagi.',
      ).catch(() => {});
    }
    return true;
  }

  return false;
}
