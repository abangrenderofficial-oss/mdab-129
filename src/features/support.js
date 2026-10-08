import {
  createSupportOrderNumber,
  createSupportPayment,
  isBayarcashConfigured,
  isBayarcashSandbox,
} from '../payments/bayarcash.js';
import { createPendingSupport, markSupportIntentCreated, markSupportIntentFailed } from '../support/store.js';
import { createSupportCheckoutTrackingUrl } from '../support/checkout-tracking.js';
import {
  activateSupportSubmissionAfterPayment,
  createSupportSubmission,
  getActiveSupportSubmission,
  markSupportSubmissionCheckout,
  markSupportSubmissionUnderReview,
  restoreSupportSubmissionAwaitingName,
  setSupportSubmissionMessage,
  setSupportSubmissionName,
} from '../support/submissions.js';
import { reconcileSupportPayment } from '../support/reconcile.js';
import { sendMessage, telegram } from '../telegram.js';
import { sendSupportQuoteToFilter } from '../support/quote-filter.js';
import { recordSupportAmountClick } from '../support/click-analytics.js';
import {currentSupportAmounts,refreshSupportAmounts,isSupportAmountCurrentlyActive,isPayPingSharedConfigEnabled} from '../support/payping-shared-config.js';
import {recordMediaXSupportPlanForOrder} from '../support/payping-order-plan.js';
import { hasMinimumWords } from '../support/text-validation.js';
import { notifySuccessfulSupportPayment } from '../support/payment-detail.js';
import { notifyWebPushSupportPayment } from '../support/webpush-payment.js';
import { notifyNtfySupportPayment } from '../support/ntfy-payment.js';
import { notifyAffiliateCommission } from '../affiliate/notify.js';
import {
  cancelPaymentFollowupByUser,
  markPaymentReview,
  stopPaymentFollowupForAmountSelection,
} from '../support/payment-followup.js';

const SUPPORT_SELECT_PREFIX = 'support:select:';
const SUPPORT_CHECK_PREFIX = 'support:check:';
const PAYMENT_FOLLOWUP_REVIEW_PREFIX = 'payfollow:review:';
const PAYMENT_FOLLOWUP_CANCEL_PREFIX = 'payfollow:cancel:';
const SUPPORT_AMOUNTS_ACTION = 'support:amounts';
const SUPPORT_BACK_ACTION = 'support:back';
const SUPPORT_ANONYMOUS_NAME_ACTION = 'support:name:anonymous';
const SUPPORT_AMOUNTS = new Set([10, 20, 30, 50, 100]);
const RETIRED_SUPPORT_AMOUNTS = new Set([1]);

const SUPPORT_TIERS = new Map([
  [1, { key: 'coffee', label: '☕️ Cofee Supporter' }],
  [10, { key: 'supporter', label: '🤍 Supporter' }],
  [20, { key: 'super', label: '🌟 Super Supporter' }],
  [30, { key: 'power', label: '💎 Power Supporter' }],
  [50, { key: 'ultimate', label: '🏆 Ultimate Supporter' }],
  [100, { key: 'legend', label: '👑 Legend Supporter' }],
]);

export function dailyForcePremiumSupportText() {
  return [
    'Hi, awak!',
    '',
    'Best tak dapat download video and post di status whatsapp tak pecah?',
    '',
    'Whatsapp awak sekarang dah PREMIUM! ☕️',
    'Utk pengetahuan awak bot ni hak milik kita semua 🇲🇾.',
    '',
    'Tapi sayang bot ni boleh mati bila2 masa 🥹, klau kita tak berjaya bayar kos sewa server.',
    '',
    'Jadi kalau awak suka bot ni, jom kita support nak? Setahun sekali pun boleh, terima kasih orang baik 🙇🏻✨',
  ].join('\n');
}

export function dailyForcePremiumChannelSupportText() {
  return [
    'Hi, korang!',
    '',
    'Best tak dapat download video and post di status whatsapp tak pecah?',
    '',
    'Whatsapp korang sekarang dah PREMIUM! ☕️',
    'Utk pengetahuan korang bot ni hak milik kita semua 🇲🇾.',
    '',
    'Tapi sayang bot ni boleh mati bila2 masa 🥹, klau kita tak berjaya bayar kos sewa server.',
    '',
    'Jadi kalau korang suka bot ni, jom kita support nak? Setahun sekali pun boleh, terima kasih orang baik 🙇🏻✨',
  ].join('\n');
}

export function supportCampaignText() {
  return [
    'Salam JUMAAT , Yaum Al - Mubarak 🌙',
    '',
    'Hi, Semua!',
    'Macam mana pengalaman korang guna bot ni, best tak? Bestkan Whatsapp Dah Premium boleh post HD ✨',
    '',
    '❌No more watermark,',
    '❌No more terpaksa download apps baru, ❌No more tambah komitmen bulanan subsription 💸!',
    '',
    'Bot ni adalah hak milik kita semua 🤍🇲🇾',
    'Sayangnya bot ni boleh mati bila2 masa, if kita tak mampu bayarkan kos sewa server.',
    '',
    'Jd kalau korang suka bot ni, jom kita sama2 support bg bot ni always hidup. ❤️',
    '',
    'Setahun Sekali Sahaja Support Pun Boleh ,',
    'Terima kasih orang baik 🙇🏻✨',
  ].join('\n');
}

function supportCommandText() {
  return [
    'Terima kasih, Orang baik!',
    'Sebab Sama2 nak bantu hidupkan Bot 🙇🏻✨',
    '',
    'Pilih Type Of Support korang 🤍',
  ].join('\n');
}

function selectedAmountFromCallback(action = '') {
  if (!String(action).startsWith(SUPPORT_SELECT_PREFIX)) return null;
  const amount = Number(String(action).slice(SUPPORT_SELECT_PREFIX.length));
  return Number.isFinite(amount) ? amount : null;
}

function amountFromCallback(action = '') {
  const amount = selectedAmountFromCallback(action);
  return currentSupportAmounts().includes(amount) ? amount : null;
}

function retiredAmountFromCallback(action = '') {
  const amount = selectedAmountFromCallback(action);
  return (RETIRED_SUPPORT_AMOUNTS.has(amount)|| (isPayPingSharedConfigEnabled() && Number.isFinite(amount)&&amount>0&&!currentSupportAmounts().includes(amount))) ? amount : null;
}

function tierForAmount(amount) {
  return SUPPORT_TIERS.get(Number(amount)) || { key: 'supporter', label: '🤍 Supporter' };
}

function modeLabel() {
  return isBayarcashSandbox() ? '🧪 SANDBOX' : '🔴 LIVE';
}

function escapeTelegramHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function supportMenuText() {
  const lines = [supportCommandText()];
  if (!isBayarcashConfigured()) lines.push('', '⚙️ Payment gateway belum lengkap di Railway.');
  return lines.join('\n');
}

function amountButtonRows(includeBack=false){
  const amounts=currentSupportAmounts();
  const rows=[];
  for(let i=0;i<amounts.length;i+=3)rows.push(amounts.slice(i,i+3).map(value=>({
    text:'RM'+value,
    callback_data:SUPPORT_SELECT_PREFIX+value,
  })));
  if(includeBack)rows.push([{text:'↩️ Back',callback_data:SUPPORT_BACK_ACTION}]);
  return rows;
}
export function supportAmountKeyboard(){
  return {inline_keyboard:amountButtonRows(false)};
}
export function supportMenuKeyboard(){
  return {inline_keyboard:amountButtonRows(true)};
}

async function editSupportMessage(callbackQuery, text, replyMarkup, extra = {}) {
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
      ...extra,
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

export async function processSupportMessage(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  const chatType = message?.chat?.type;
  if (!chatId || !userId || chatType !== 'private') return false;

  const rawText = String(message?.text || message?.caption || '').trim();
  if (!rawText || rawText.startsWith('/') || /https?:\/\/\S+/i.test(rawText)) return false;

  let submission = null;
  try {
    submission = await getActiveSupportSubmission(userId);
  } catch (error) {
    console.warn('[support] active testimonial lookup failed:', error?.message);
    return false;
  }
  if (!submission) return false;

  if (submission.state === 'AWAITING_MESSAGE') {
    const supportMessage = rawText.slice(0, 500).trim();
    if (!hasMinimumWords(supportMessage, 5)) {
      await sendMessage(
        chatId,
        'Pastikan kata2 support mestilah 5 patah perkataan ke atas.',
      ).catch(() => {});
      return true;
    }

    const updated = await setSupportSubmissionMessage(submission.orderNumber, userId, supportMessage);
    if (!updated || updated.state !== 'AWAITING_NAME') {
      await sendMessage(chatId, 'Kata-kata support belum berjaya disimpan. Cuba sekali lagi ya.').catch(() => {});
      return true;
    }

    await sendMessage(
      chatId,
      'Boleh saya tahu nama? Kalau tak nak paparkan nama, pilih Anonymous.',
      {
        reply_markup: {
          inline_keyboard: [[{ text: 'Anonymous', callback_data: SUPPORT_ANONYMOUS_NAME_ACTION }]],
        },
      },
    ).catch(() => {});
    return true;
  }

  if (submission.state === 'AWAITING_NAME') {
    const typedName = rawText.slice(0, 60).trim();
    const displayName = /^(anonymous|anon|skip|tak nak|taknak)$/i.test(typedName)
      ? 'Anonymous'
      : typedName;
    if (!displayName) {
      await sendMessage(chatId, 'Isi nama atau pilih Anonymous ya.').catch(() => {});
      return true;
    }

    try {
      const ready = await setSupportSubmissionName(submission.orderNumber, userId, displayName);
      if (!ready || ready.state !== 'READY') throw new Error('support_submission_not_ready');

      const review = await markSupportSubmissionUnderReview(ready.orderNumber, userId);
      if (!review || review.state !== 'REVIEW') throw new Error('support_submission_review_state_failed');

      await sendSupportQuoteToFilter({
        supportMessage: review.supportMessage,
        displayName: review.displayName,
        tierLabel: review.tierLabel,
        orderNumber: review.orderNumber,
        userId: review.telegramUserId,
      });

      await sendMessage(
        chatId,
        'Terima Kasih Sekali lagi, bantu support bot kita sama2 kekal hidup. 🙇🏻✨',
      ).catch(() => {});
    } catch (error) {
      console.warn('[support] testimonial filter delivery failed:', error?.code, error?.message);
      await restoreSupportSubmissionAwaitingName(submission.orderNumber, userId).catch(() => {});
      await sendMessage(
        chatId,
        error?.code === 'QUOTE_FILTER_NOT_CONNECTED'
          ? 'Kata-kata support dah disimpan, tapi group filter belum disambungkan. Cuba hantar nama semula kejap lagi ya.'
          : 'Kata-kata support belum berjaya dihantar untuk review. Cuba hantar nama sekali lagi kejap lagi ya.',
      ).catch(() => {});
    }
    return true;
  }

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

    if (status.result?.affiliate?.created) {
      await notifyAffiliateCommission(status.result.affiliate).catch((error) => {
        console.warn('[affiliate] reconciliation commission notification failed:', error?.message);
      });
    }

    if (status.orderNumber) {
      await notifySuccessfulSupportPayment(status.orderNumber).catch((error) => {
        console.warn('[payment-detail] check-status notification failed:', error?.message);
      });
      await notifyNtfySupportPayment(status.orderNumber).catch((error) => {
        console.warn('[ntfy-payment] check-status notification failed:', error?.message);
      });
    }

    if (status.orderNumber) {
      const activation = await activateSupportSubmissionAfterPayment(status.orderNumber).catch((error) => {
        console.warn('[support] testimonial activation failed:', error?.message);
        return null;
      });
      if (activation?.activated) {
        await sendMessage(
          callbackQuery?.from?.id,
          'Tinggalkan kata-kata support korang ❤️',
        ).catch((error) => console.warn('[support] testimonial prompt failed:', error?.message));
      }
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
      { inline_keyboard: [[{ text: '← Support Amount Lain', callback_data: SUPPORT_AMOUNTS_ACTION }]] },
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
  if(action.startsWith(SUPPORT_SELECT_PREFIX)||action===SUPPORT_AMOUNTS_ACTION){try{await refreshSupportAmounts(true)}catch(e){console.warn('[payping-shared] amount menu refresh failed:',e.message)}}

  if (action.startsWith(PAYMENT_FOLLOWUP_REVIEW_PREFIX)) {
    const orderNumber = action.slice(PAYMENT_FOLLOWUP_REVIEW_PREFIX.length).trim();
    try {
      const result = await markPaymentReview(orderNumber, callbackQuery?.from?.id);
      if (result?.resolved) {
        await answerSupportCallback(callbackQuery, '✅ Payment dah confirmed.');
        await editSupportMessage(
          callbackQuery,
          '✅ Payment dah confirmed. Terima kasih banyak-banyak sebab support bot kita ❤️',
          { inline_keyboard: [] },
        );
      } else {
        await answerSupportCallback(callbackQuery, '🔎 Payment masuk untuk semakan.');
        await editSupportMessage(
          callbackQuery,
          [
            '🔎 PAYMENT REVIEW',
            '',
            'Awak dah maklumkan bayaran telah dibuat.',
            'Kami akan semak status dengan Bayarcash.',
            '',
            'Jangan buat bayaran kali kedua untuk checkout ini sementara semakan dibuat.',
            `Support ID: ${orderNumber}`,
          ].join('\n'),
          { inline_keyboard: [] },
        );
      }
    } catch (error) {
      console.warn('[payment-followup] review callback failed:', error?.code, error?.message);
      await answerSupportCallback(callbackQuery, 'Tak berjaya semak payment sekarang. Cuba lagi kejap.', true);
    }
    return true;
  }

  if (action.startsWith(PAYMENT_FOLLOWUP_CANCEL_PREFIX)) {
    const orderNumber = action.slice(PAYMENT_FOLLOWUP_CANCEL_PREFIX.length).trim();
    try {
      await cancelPaymentFollowupByUser(orderNumber, callbackQuery?.from?.id);
      await answerSupportCallback(callbackQuery, 'Follow-up dihentikan.');
      await editSupportMessage(
        callbackQuery,
        ['Okay, reminder untuk checkout ini dah dihentikan.', '', 'Kalau perlu, admin masih boleh follow up secara manual.', `Support ID: ${orderNumber}`].join('\n'),
        { inline_keyboard: [] },
      );
    } catch (error) {
      console.warn('[payment-followup] cancel callback failed:', error?.code, error?.message);
      await answerSupportCallback(callbackQuery, 'Tak berjaya hentikan checkout sekarang.', true);
    }
    return true;
  }

  const amount = amountFromCallback(action);
  const retiredAmount = retiredAmountFromCallback(action);
  const isCheckAction = action.startsWith(SUPPORT_CHECK_PREFIX);
  const isSupportAction = Boolean(amount)
    || Boolean(retiredAmount)
    || isCheckAction
    || action === SUPPORT_AMOUNTS_ACTION
    || action === SUPPORT_BACK_ACTION
    || action === SUPPORT_ANONYMOUS_NAME_ACTION;
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

  if (action === SUPPORT_ANONYMOUS_NAME_ACTION) {
    let submission = null;
    try {
      submission = await getActiveSupportSubmission(user.id);
    } catch (error) {
      console.warn('[support] anonymous name lookup failed:', error?.message);
    }

    if (!submission || submission.state !== 'AWAITING_NAME') {
      await answerSupportCallback(callbackQuery, 'Tiada kata-kata support yang tunggu nama sekarang.', true);
      return true;
    }

    try {
      const ready = await setSupportSubmissionName(submission.orderNumber, user.id, 'Anonymous');
      if (!ready || ready.state !== 'READY') throw new Error('support_submission_not_ready');

      const review = await markSupportSubmissionUnderReview(ready.orderNumber, user.id);
      if (!review || review.state !== 'REVIEW') throw new Error('support_submission_review_state_failed');

      await sendSupportQuoteToFilter({
        supportMessage: review.supportMessage,
        displayName: 'Anonymous',
        tierLabel: review.tierLabel,
        orderNumber: review.orderNumber,
        userId: review.telegramUserId,
      });

      await answerSupportCallback(callbackQuery, 'Anonymous dipilih ✅');
      await editSupportMessage(
        callbackQuery,
        'Nama paparan: Anonymous ✅',
        { inline_keyboard: [] },
      );
      await sendMessage(
        user.id,
        'Terima Kasih Sekali lagi, bantu support bot kita sama2 kekal hidup. 🙇🏻✨',
      ).catch(() => {});
    } catch (error) {
      console.warn('[support] anonymous testimonial filter delivery failed:', error?.code, error?.message);
      await restoreSupportSubmissionAwaitingName(submission.orderNumber, user.id).catch(() => {});
      await answerSupportCallback(callbackQuery, 'Belum berjaya hantar untuk review. Cuba lagi kejap.', true);
    }
    return true;
  }

  if (amount && isPayPingSharedConfigEnabled()) {
    let active=false;
    try{active=await isSupportAmountCurrentlyActive(amount)}catch(e){
      console.warn('[payping-shared] checkout amount validation unavailable:',e.message);
      await answerSupportCallback(callbackQuery,'Sistem payment sedang dikemaskini. Cuba lagi sebentar.',true);
      return true;
    }
    if(!active){
      await answerSupportCallback(callbackQuery,'Amaun ini sudah tidak aktif. Pilih amount yang terkini.',true);
      await editSupportMessage(callbackQuery,supportMenuText(),supportMenuKeyboard());
      return true;
    }
  }
  if (amount) {
    await stopPaymentFollowupForAmountSelection(messageId, user.id).catch((error) => {
      console.warn('[payment-followup] amount selection stop failed:', error?.message);
    });
    await recordSupportAmountClick(callbackQuery, amount).catch((error) => {
      console.warn('[support-per-click] record failed:', error?.message);
    });
  }

  if (retiredAmount) {
    await answerSupportCallback(callbackQuery, 'Pilihan jumlah support ini tidak aktif lagi. Sila pilih amaun yang tersedia ❤️', true);
    await editSupportMessage(callbackQuery, supportMenuText(), supportMenuKeyboard());
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
      await telegram('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
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

    await recordMediaXSupportPlanForOrder(orderNumber,amount);

    const payment = await createSupportPayment({
      amount,
      user,
      publicBaseUrl: context.baseUrl,
      orderNumber,
    });

    await markSupportIntentCreated(orderNumber, payment.paymentIntentId);
    await markSupportSubmissionCheckout(orderNumber, payment.url, payment.paymentIntentId);

    let trackedPaymentUrl = payment.url;
    try {
      trackedPaymentUrl = createSupportCheckoutTrackingUrl({
        publicBaseUrl: context.baseUrl,
        orderNumber: payment.orderNumber,
      });
    } catch (trackingError) {
      console.warn('[checkout-tracking] signed URL fallback:', trackingError?.code, trackingError?.message);
    }

    const keyboard = [[{ text: `💳 Bayar RM${amount}`, url: trackedPaymentUrl }]];
    if (payment.paymentIntentId) {
      keyboard.push([{
        text: '🔎 Check Status',
        callback_data: `${SUPPORT_CHECK_PREFIX}${payment.paymentIntentId}`,
      }]);
    }
    keyboard.push([{ text: '← Tukar Amount', callback_data: SUPPORT_AMOUNTS_ACTION }]);

    const title = `${tier.label.toUpperCase()} !`;
    const detailLines = [
      `Amount: RM${Number(amount).toFixed(2)}`,
      `Support ID: ${escapeTelegramHtml(payment.orderNumber)}`,
      `Channel: ${escapeTelegramHtml(payment.paymentChannelLabel)}`,
    ];
    if (payment.paymentIntentId) {
      detailLines.push(`Payment Intent: ${escapeTelegramHtml(payment.paymentIntentId)}`);
    }

    await editSupportMessage(
      callbackQuery,
      [`<b>${escapeTelegramHtml(title)}</b>`, '', ...detailLines].join('\n'),
      { inline_keyboard: keyboard },
      { parse_mode: 'HTML' },
    );
  } catch (error) {
    await markSupportIntentFailed(orderNumber, error?.code || 'UNKNOWN').catch(() => {});
    await notifyWebPushSupportPayment(orderNumber).catch((pushError) => {
      console.warn('[webpush-payment] intent failure notification failed:', pushError?.message);
    });
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
