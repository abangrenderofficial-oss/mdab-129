import { isResetAdmin } from '../recovery.js';
import { sendMessage } from '../telegram.js';
import { createPushSetupCode } from '../support/webpush-payment.js';

export async function handlePaymentPushSetupCommand(message = {}, context = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return true;

  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ /pushsetup hanya untuk owner bot.').catch(() => {});
    return true;
  }
  if (message?.chat?.type !== 'private') {
    await sendMessage(chatId, '❌ /pushsetup hanya boleh digunakan dalam private chat bot.').catch(() => {});
    return true;
  }

  try {
    const setup = await createPushSetupCode(userId);
    const baseUrl = String(context?.baseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const appUrl = baseUrl ? `${baseUrl}/ar-payment` : '/ar-payment';
    await sendMessage(chatId, [
      '📲 AR Payment Push Setup','',
      '1. Buka link ini dalam Safari:',appUrl,'',
      '2. Share → Add to Home Screen.',
      '3. Buka AR Payment dari Home Screen.',
      '4. Masukkan setup code:',setup.code,'',
      '5. Tekan Enable Notifications.','',
      'Code sah 10 minit dan hanya boleh digunakan sekali.',
    ].join('\n'));
  } catch (error) {
    console.error('[pushsetup] failed:', error?.message);
    await sendMessage(chatId, '❌ Tak berjaya generate AR Payment setup code sekarang.').catch(() => {});
  }
  return true;
}
