import { consumePayPingTelegramLinkCode } from '../payping/auth.js';
import { sendMessage } from '../telegram.js';

export async function handlePayPingAccountLinkStart(message = {}, payload = '') {
  const chatId = message?.chat?.id;
  if (!chatId) return;
  if (message?.chat?.type !== 'private') {
    return sendMessage(chatId, '❌ PayPing account linking hanya boleh dibuat dalam private chat bot.');
  }

  const value = String(payload || '').trim().toLowerCase();
  const code = value.startsWith('payping_') ? value.slice('payping_'.length) : '';
  try {
    await consumePayPingTelegramLinkCode(code, message?.from?.id);
    return sendMessage(
      chatId,
      '✅ PayPing account linked dengan Telegram ini.\n\nKembali ke PayPing dan buka semula app / refresh.',
    );
  } catch (error) {
    const known = new Set([
      'PAYPING_LINK_EXPIRED',
      'PAYPING_LINK_ALREADY_USED',
      'INVALID_PAYPING_LINK_CODE',
      'TELEGRAM_ALREADY_LINKED',
      'ACCOUNT_ALREADY_LINKED',
    ]);
    if (known.has(String(error?.code || ''))) {
      return sendMessage(
        chatId,
        '❌ Link PayPing ini sudah expired / digunakan / tidak sah. Generate link baru dari PayPing.',
      );
    }
    console.warn('[payping-link] failed:', error?.code, error?.message);
    return sendMessage(chatId, '❌ Tak berjaya link PayPing sekarang. Cuba generate link baru dari app.');
  }
}
