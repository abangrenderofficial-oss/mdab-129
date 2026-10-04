import { createHmac, timingSafeEqual } from 'node:crypto';

import { isBayarcashSandbox } from '../payments/bayarcash.js';
import { currentSupportEnvironment } from './store.js';
import { getSupportSubmission, markSupportCheckoutOpened } from './submissions.js';

function clean(value, max = 300) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function trackingSecret() {
  const explicit = clean(process.env.SUPPORT_CHECKOUT_TRACKING_SECRET, 1000);
  if (explicit) return explicit;

  const gateway = isBayarcashSandbox()
    ? clean(process.env.BAYARCASH_SANDBOX_API_SECRET_KEY, 1000)
    : clean(process.env.BAYARCASH_API_SECRET_KEY, 1000);
  if (gateway) return gateway;

  const webhook = clean(process.env.TELEGRAM_WEBHOOK_SECRET, 1000);
  if (webhook) return webhook;

  const error = new Error('Checkout tracking secret is not configured.');
  error.code = 'CHECKOUT_TRACKING_NOT_CONFIGURED';
  throw error;
}

function signaturePayload(orderNumber) {
  return [currentSupportEnvironment(), clean(orderNumber, 120)].join('|');
}

export function signSupportCheckout(orderNumber) {
  const order = clean(orderNumber, 120);
  if (!order) {
    const error = new Error('Support order is required.');
    error.code = 'CHECKOUT_ORDER_REQUIRED';
    throw error;
  }
  return createHmac('sha256', trackingSecret())
    .update(signaturePayload(order))
    .digest('base64url');
}

export function verifySupportCheckoutSignature(orderNumber, signature) {
  const provided = clean(signature, 200);
  if (!provided) return false;
  const expected = signSupportCheckout(orderNumber);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSupportCheckoutTrackingUrl({ publicBaseUrl = '', orderNumber = '' } = {}) {
  const base = clean(publicBaseUrl || process.env.PUBLIC_BASE_URL, 1000).replace(/\/$/, '');
  if (!base) {
    const error = new Error('PUBLIC_BASE_URL is required for checkout tracking.');
    error.code = 'CHECKOUT_PUBLIC_URL_MISSING';
    throw error;
  }
  const order = clean(orderNumber, 120);
  const sig = signSupportCheckout(order);
  return base + '/api/support-checkout?order=' + encodeURIComponent(order) + '&sig=' + encodeURIComponent(sig);
}

function safePaymentUrl(value) {
  const raw = clean(value, 2000);
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export async function resolveSupportCheckoutRedirect({
  orderNumber = '',
  signature = '',
  recordOpen = true,
} = {}) {
  const order = clean(orderNumber, 120);
  if (!order || !verifySupportCheckoutSignature(order, signature)) {
    const error = new Error('Checkout link tidak sah.');
    error.code = 'CHECKOUT_LINK_INVALID';
    throw error;
  }

  const submission = await getSupportSubmission(order);
  if (!submission) {
    const error = new Error('Checkout tidak dijumpai.');
    error.code = 'CHECKOUT_NOT_FOUND';
    throw error;
  }

  const paymentUrl = safePaymentUrl(submission.paymentUrl);
  if (!paymentUrl) {
    const error = new Error('Payment URL tidak tersedia.');
    error.code = 'CHECKOUT_PAYMENT_URL_MISSING';
    throw error;
  }

  const tracked = recordOpen ? await markSupportCheckoutOpened(order) : submission;
  return {
    orderNumber: order,
    paymentUrl,
    openCount: Number(tracked?.checkoutOpenCount || 0),
    firstOpenedAt: tracked?.checkoutFirstOpenedAt || null,
    lastOpenedAt: tracked?.checkoutLastOpenedAt || null,
  };
}
