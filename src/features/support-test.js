import {
  choosePreferredPaymentChannel,
  createSupportOrderNumber,
  createSupportPayment,
  getBayarcashPaymentIntent,
  getBayarcashPortalDiagnostic,
  isBayarcashConfigured,
  isBayarcashSandbox,
} from '../payments/bayarcash.js';
import { createPendingSupport, markSupportIntentCreated, markSupportIntentFailed } from '../support/store.js';
import { sendMessage } from '../telegram.js';
import { isResetAdmin } from '../recovery.js';

const SUPPORT_AMOUNTS = [1, 10, 20, 30, 50, 100];
const SUPPORT_CHECK_PREFIX = 'support:check:';

function commandAmount(message = {}) {
  const text = String(message?.text || '').trim();
  const [, raw] = text.split(/\s+/);
  const amount = Number(raw || 1);
  if (!SUPPORT_AMOUNTS.includes(amount)) return null;
  return amount;
}

function channelSummary(channels = []) {
  if (!channels.length) return 'None';
  return channels
    .map((channel) => `${channel.id} ${channel.name || channel.label || channel.code || 'Channel'}`)
    .join(', ');
}

function assertPaymentIntentReadBack(intent, payment) {
  const returnedId = String(intent?.id || '');
  const returnedOrder = String(intent?.order_number || '');
  const returnedAmount = Number(intent?.amount || 0);

  if (!returnedId || returnedId !== String(payment.paymentIntentId || '')) {
    const error = new Error('Bayarcash read-back returned a different payment intent ID.');
    error.code = 'BAYARCASH_READBACK_ID_MISMATCH';
    throw error;
  }
  if (!returnedOrder || returnedOrder !== String(payment.orderNumber || '')) {
    const error = new Error('Bayarcash read-back returned a different order number.');
    error.code = 'BAYARCASH_READBACK_ORDER_MISMATCH';
    throw error;
  }
  if (!Number.isFinite(returnedAmount) || Math.abs(returnedAmount - Number(payment.amount)) > 0.0001) {
    const error = new Error('Bayarcash read-back returned a different amount.');
    error.code = 'BAYARCASH_READBACK_AMOUNT_MISMATCH';
    throw error;
  }
}

export async function handleSupportTestCommand(message, context = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId) return true;

  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ /supporttest hanya untuk owner bot.').catch(() => {});
    return true;
  }

  const sandbox = isBayarcashSandbox();
  const modeLabel = sandbox ? '🧪 SANDBOX' : '🔴 LIVE';

  if (!isBayarcashConfigured()) {
    const required = sandbox
      ? 'BAYARCASH_SANDBOX_API_TOKEN, BAYARCASH_SANDBOX_API_SECRET_KEY dan BAYARCASH_SANDBOX_PORTAL_KEY'
      : 'BAYARCASH_API_TOKEN, BAYARCASH_API_SECRET_KEY dan BAYARCASH_PORTAL_KEY';
    await sendMessage(
      chatId,
      `⚙️ Bayarcash ${modeLabel} belum lengkap di Railway. ${required} belum aktif.`,
    );
    return true;
  }

  const amount = commandAmount(message);
  if (!amount) {
    await sendMessage(chatId, 'Guna: /supporttest 1\nPilihan: RM1, RM10, RM20, RM30, RM50 atau RM100.');
    return true;
  }

  let orderNumber = '';
  try {
    await sendMessage(chatId, `${modeLabel}\n🔎 Checking API token, portal & payment channels...`).catch(() => {});

    const diagnostic = await getBayarcashPortalDiagnostic();
    const testChannel = choosePreferredPaymentChannel(diagnostic.paymentChannels);
    if (!testChannel) {
      const error = new Error('Portal dijumpai tetapi tiada payment channel aktif.');
      error.code = 'BAYARCASH_NO_ACTIVE_CHANNEL';
      throw error;
    }

    await sendMessage(
      chatId,
      [
        `${modeLabel}`,
        '✅ Bayarcash API connection OK.',
        `Portal: ${diagnostic.portalName}`,
        `Active channels: ${channelSummary(diagnostic.paymentChannels)}`,
        `Selected channel: ${testChannel.id} ${testChannel.name || testChannel.label || testChannel.code || ''}`.trim(),
      ].join('\n'),
    ).catch(() => {});

    orderNumber = createSupportOrderNumber();
    await createPendingSupport({
      orderNumber,
      userId,
      username: message?.from?.username || '',
      amount,
    });

    await sendMessage(chatId, `${modeLabel}\n⏳ Creating Bayarcash payment intent RM${amount}...`).catch(() => {});

    const payment = await createSupportPayment({
      amount,
      user: message.from,
      publicBaseUrl: context.baseUrl,
      orderNumber,
      paymentChannel: testChannel.id,
    });
    await markSupportIntentCreated(orderNumber, payment.paymentIntentId);

    if (!payment.paymentIntentId) {
      const error = new Error('Bayarcash accepted checkout but did not return payment intent ID.');
      error.code = 'BAYARCASH_PAYMENT_INTENT_ID_MISSING';
      throw error;
    }

    const readBack = await getBayarcashPaymentIntent(payment.paymentIntentId);
    assertPaymentIntentReadBack(readBack, payment);

    const keyboard = [
      [{ text: `${sandbox ? '🧪 Test' : '💳 Bayar'} RM${amount}`, url: payment.url }],
      [{ text: '🔎 Check Bayarcash', callback_data: `${SUPPORT_CHECK_PREFIX}${payment.paymentIntentId}` }],
    ];

    await sendMessage(
      chatId,
      [
        `${modeLabel}`,
        '✅ BAYARCASH ACCEPTED + READ-BACK OK',
        '',
        `Amount: RM${payment.amount}`,
        `Support ID: ${payment.orderNumber}`,
        `Payment Intent: ${payment.paymentIntentId}`,
        `Channel: ${payment.paymentChannelLabel}`,
        `Gateway status sekarang: ${readBack?.status || 'new/pending'}`,
        '',
        sandbox
          ? 'Sandbox sahaja — tiada duit sebenar digunakan.'
          : 'LIVE — RM1 sebenar hanya dicaj selepas kau authorize di bank/wallet.',
        '',
        'Selepas payment selesai, tekan “Check Bayarcash”.',
      ].join('\n'),
      { reply_markup: { inline_keyboard: keyboard } },
    );
  } catch (error) {
    if (orderNumber) await markSupportIntentFailed(orderNumber, error?.code || 'UNKNOWN').catch(() => {});
    console.error('[support-test] Bayarcash failed:', error?.code, error?.status, error?.message, error?.details || '');
    await sendMessage(
      chatId,
      [
        `${modeLabel}`,
        '❌ Bayarcash support test gagal.',
        error?.message || 'Unknown error',
        '',
        `Code: ${error?.code || 'UNKNOWN'}`,
        error?.status ? `HTTP: ${error.status}` : '',
      ].filter(Boolean).join('\n'),
    ).catch(() => {});
  }

  return true;
}
