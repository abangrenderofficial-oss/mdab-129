import {
  createSupportOrderNumber,
  createSupportPayment,
  isBayarcashConfigured,
  isBayarcashSandbox,
} from '../payments/bayarcash.js';
import { createPendingSupport, markSupportIntentCreated, markSupportIntentFailed } from '../support/store.js';
import { createSupportSubmission, markSupportSubmissionCheckout } from '../support/submissions.js';
import { reconcileSupportPayment } from '../support/reconcile.js';
import { sendMessage, telegram } from '../telegram.js';

const SUPPORT_SELECT_PREFIX = 'support:select:';
const SUPPORT_CHECK_PREFIX = 'support:check:';
const SUPPORT_AMOUNTS_ACTION = 'support:amounts';
const SUPPORT_BACK_ACTION = 'support:back';
const SUPPORT_AMOUNTS = new Set([1, 10, 20, 30, 50, 100]);

const SUPPORT_TIERS = new Map([
  [1, { key: 'coffee', label: '☕️ Cofee Supporter' }],
  [10, { key: 'supporter', label: '🤍 Supporter' }],
  [20, { key: 'super', label: '🌟 Super Supporter' }],
  [30, { key: 'power', label: '💎 Power Supporter' }],
  [50, { key: 'ultimate', label: '🏆 Ultimate Supporter' }],
  [100, { key: 'legend', label: '👑 Legend Supporter' }],
]);

function amountFromCallback(action = '') {
  if (!String(action).startsWith(SUPPORT_SELECT_PREFIX)) return null;
  const amount = Number(String(action).slice(SUPPORT_SELECT_PREFIX.length));
  return SUPPORT_AMOUNTS.has(amount) ? amount : null;
}

function tierForAmount(amount) {
  return SUPPORT_TIERS.get(Number(amount)) || { key: 'supporter', label: '🤍 Supporter' };
}

function modeLabel() {
  return isBayarcashSandbox() ? '🧪 SANDBOX' : '🔴 LIVE';
}

function supportMenuText() {
  return [
    '❤️ Support Perkembangan Bot',
    '',
    'Bot ni free untuk korang guna. Kalau rasa bot ni membantu, korang boleh support ikut kemampuan.',
    '',
    'Support korang bantu cover sewa server dan perkembangan bot supaya bot ni boleh stay dan terus korang guna.',
    'Sekali seumur hidup pun tak pe. Terima kasih orang baik ! 🙇🏻❤️',
    '',
    'Pilih amount support:',
    '☕️ RM1 — Cofee Supporter',
    '🤍 RM10 — Supporter',
    '🌟 RM20 — Super Supporter',
    '💎 RM30 — Power Supporter',
    '🏆 RM50 — Ultimate Supporter',
    '👑 RM100 — Legend Supporter',
    '',
    `${modeLabel()} Bayarcash`,
    ...(!isBayarcashConfigured() ? ['', '⚙️ Payment gateway belum lengkap di Railway.'] : []),
  ].join('\n');
}

function supportMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '☕️ RM1', callback_data: `${SUPPORT_SELECT_PREFIX}1` }],
      [
        { text: 'RM10', callback_data: `${SUPPORT_SELECT_PREFIX}10` },
        { text: 'RM20', callback_data: `${SUPPORT_SELECT_PREFIX}20` },
        { text: 'RM30', callback_data: `${SUPPORT_SELECT_PREFIX}30` },
      ],
      [
        { text: 'RM50', callback_data: `${SUPPORT_SELECT_PREFIX}50` },
        { text: 'RM100', callback_data: `${SUPPORT_SELECT_PREFIX}100` },
      ],
      [{ text: '↩️ Back', callback_data: SUPPORT_BACK_ACTION }],
    ],
  };
}

async function editSupportMessage(callbackQuery, text, replyMarkup) {
  const chatId = callbackQuery?.message?.chat?.id;
  const messageId = callbackQuery?.message?.message_id;
  if (!chatId || !messageId) return false;

  try {
    await telegram('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
    return true;
  } catch (error) {
    if (String(error?.message || '').includes('message is not modified')) return true;
    console.warn('[support] edit message failed:', error?.message);
    return false;
  }
}

async function answerSupportCallback(callbackQuery, text = '', showAlert = false) {
  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery?.id,
    ...(text ? { text } : {}),
    show_alert: Boolean(showAlert),
  }).catch(() => {});
}

export async function handleSupportCommand(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return true;

  if (message?.chat?.type && message.chat.type !== 'private') {
    await sendMessage(chatId, '❤️ Guna /support dalam private chat dengan bot ya.').catch(() => {});
    return true;
  }

  await sendMessage(chatId, supportMenuText(), {
    reply_markup: supportMenuKeyboard(),
  });
  return true;
}

// Feedback/name capture is intentionally disabled for now.
export async function processSupportMessage() {
  return false;
}

async function handlePaymentCheck(callbackQuery, paymentIntentId) {
  await answerSupportCallback(callbackQuery, '🔎 Semak terus dengan Bayarcash...');

  try {
    const status = await reconcileSupportPayment({ paymentIntentId });
    const statusText = status.intentStatus || status.transactionStatus || 'pending';

    if (!status.paid) {
      await answerSupportCallback(
        callbackQuery,
        `Bayarcash: ${statusText}. Belum confirmed paid.`,
        true,
      );
      return true;
    }

    const lines = [
      '✅ BAYARCASH CONFIRMED PAYMENT',
      '',
      `${modeLabel()}`,
      status.amount ? `Amount: RM${Number(status.amount).toFixed(2)}` : '',
      status.orderNumber ? `Support ID: ${status.orderNumber}` : '',
      status.transactionId ? `Transaction: ${status.transactionId}` : '',
      `Status: ${status.intentStatus || status.transactionStatus || 'paid'}`,
      '',
      'Bayarcash API telah sahkan payment ini sebagai berjaya.',
    ].filter(Boolean);

    await editSupportMessage(
      callbackQuery,
      lines.join('\n'),
      {
        inline_keyboard: [
          [{ text: '← Support Amount Lain', callback_data: SUPPORT_AMOUNTS_ACTION }],
        ],
      },
    );
    return true;
  } catch (error) {
    console.error('[support] Bayarcash reconciliation failed:', error?.code, error?.status, error?.message);
    await answerSupportCallback(
      callbackQuery,
      `Semakan Bayarcash gagal: ${error?.code || error?.message || 'UNKNOWN'}`,
      true,
    );
    return true;
  }
}

export async function processSupportCallback(callbackQuery = {}, context = {}) {
  const action = String(callbackQuery?.data || '');
  const amount = amountFromCallback(action);
  const isCheckAction = action.startsWith(SUPPORT_CHECK_PREFIX);
  const isSupportAction = Boolean(amount)
    || isCheckAction
    || action === SUPPORT_AMOUNTS_ACTION
    || action === SUPPORT_BACK_ACTION;
  if (!isSupportAction) return false;

  const chatId = callbackQuery?.message?.chat?.id;
  const messageId = callbackQuery?.message?.message_id;
  const chatType = callbackQuery?.message?.chat?.type;
  const user = callbackQuery?.from || {};
  if (!chatId || !user?.id) return true;

  if (chatType && chatType !== 'private') {
    await answerSupportCallback(callbackQuery, 'Buka private chat bot untuk support ya ❤️', true);
    return true;
  }

  if (isCheckAction) {
    const paymentIntentId = action.slice(SUPPORT_CHECK_PREFIX.length).trim();
    if (!paymentIntentId) {
      await answerSupportCallback(callbackQuery, 'Payment intent ID tak dijumpai.', true);
      return true;
    }
    return handlePaymentCheck(callbackQuery, paymentIntentId);
  }

  if (action === SUPPORT_BACK_ACTION) {
    await answerSupportCallback(callbackQuery);
    if (messageId) {
      await telegram('deleteMessage', {
        chat_id: chatId,
        message_id: messageId,
      }).catch(() => {});
    }
    return true;
  }

  if (action === SUPPORT_AMOUNTS_ACTION) {
    await answerSupportCallback(callbackQuery);
    await editSupportMessage(callbackQuery, supportMenuText(), supportMenuKeyboard());
    return true;
  }

  const tier = tierForAmount(amount);
  await answerSupportCallback(callbackQuery, `${tier.label} dipilih!`);

  if (!isBayarcashConfigured()) {
    await editSupportMessage(
      callbackQuery,
      '⚙️ Payment gateway belum lengkap di Railway.',
      { inline_keyboard: [[{ text: '← Tukar Amount', callback_data: SUPPORT_AMOUNTS_ACTION }]] },
    );
    return true;
  }

  const orderNumber = createSupportOrderNumber();
  try {
    await createSupportSubmission({
      orderNumber,
      userId: user.id,
      username: user.username || '',
      amount,
      tierKey: tier.key,
      tierLabel: tier.label,
    });

    await createPendingSupport({
      orderNumber,
      userId: user.id,
      username: user.username || '',
      amount,
    });

    const payment = await createSupportPayment({
      amount,
      user,
      publicBaseUrl: context.baseUrl,
      orderNumber,
    });

    await markSupportIntentCreated(orderNumber, payment.paymentIntentId);
    await markSupportSubmissionCheckout(orderNumber, payment.url, payment.paymentIntentId);

    const keyboard = [
      [{ text: `💳 Bayar RM${amount}`, url: payment.url }],
    ];
    if (payment.paymentIntentId) {
      keyboard.push([{
        text: '🔎 Check Bayarcash',
        callback_data: `${SUPPORT_CHECK_PREFIX}${payment.paymentIntentId}`,
      }]);
    }
    keyboard.push([{ text: '← Tukar Amount', callback_data: SUPPORT_AMOUNTS_ACTION }]);

    await editSupportMessage(
      callbackQuery,
      [
        `${tier.label}`,
        '',
        `${modeLabel()} Bayarcash`,
        `Amount: RM${Number(amount).toFixed(2)}`,
        `Support ID: ${payment.orderNumber}`,
        `Channel: ${payment.paymentChannelLabel}`,
        payment.paymentIntentId ? `Payment Intent: ${payment.paymentIntentId}` : '',
        '',
        isBayarcashSandbox()
          ? 'Sandbox test sahaja — tiada duit sebenar.'
          : 'LIVE payment — duit hanya dicaj selepas kau authorize payment di bank/wallet.',
        '',
        'Selepas bayar, tekan “Check Bayarcash” untuk semak status terus daripada gateway.',
      ].filter(Boolean).join('\n'),
      { inline_keyboard: keyboard },
    );
  } catch (error) {
    await markSupportIntentFailed(orderNumber, error?.code || 'UNKNOWN').catch(() => {});
    console.error('[support] checkout failed:', error?.code, error?.status, error?.message, error?.details || '');
    await editSupportMessage(
      callbackQuery,
      error?.code === 'BAYARCASH_PAYER_EMAIL_REQUIRED'
        ? '⚙️ Support payment belum ready sepenuhnya. Admin tengah lengkapkan email payment gateway.'
        : `❌ Payment page tak dapat dibuat. ${error?.code || error?.message || 'UNKNOWN'}`,
      { inline_keyboard: [[{ text: '← Tukar Amount', callback_data: SUPPORT_AMOUNTS_ACTION }]] },
    );
  }

  return true;
}
