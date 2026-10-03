import { createPayPingLinkCode } from '../payping/auth.js';
import { sendMessage } from '../telegram.js';

export async function handlePayPingLinkCommand(message = {}, context = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return true;

  if (message?.chat?.type !== 'private') {
    await sendMessage(chatId, '❌ /payping hanya boleh digunakan dalam private chat bot.').catch(() => {});
    return true;
  }

  try {
    const link = await createPayPingLinkCode(userId);
    const baseUrl = String(context?.baseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const appUrl = baseUrl ? `${baseUrl}/ar-payment/login` : '/ar-payment/login';
    await sendMessage(chatId, [
      '🔐 PayPing Login',
      '',
      'Buka PayPing:',
      appUrl,
      '',
      'Setup code:',
      link.code,
      '',
      'Code sah 10 minit dan hanya boleh digunakan sekali.',
      'Masukkan code ini pada halaman Connect Telegram selepas register/login.',
    ].join('\n'));
  } catch (error) {
    console.error('[payping-link] failed:', error?.message);
    await sendMessage(chatId, '❌ Tak berjaya generate PayPing setup code sekarang.').catch(() => {});
  }
  return true;
}
