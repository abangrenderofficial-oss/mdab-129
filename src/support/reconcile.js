import {
  getBayarcashPaymentIntent,
  getBayarcashTransactionsByOrderNumber,
} from '../payments/bayarcash.js';
import { applyBayarcashTransaction } from './store.js';

function transactionPayload(transaction = {}, fallback = {}) {
  return {
    record_type: 'transaction',
    transaction_id: String(transaction?.id || transaction?.transaction_id || ''),
    exchange_reference_number: String(transaction?.exchange_reference_number || ''),
    exchange_transaction_id: String(transaction?.exchange_transaction_id || ''),
    order_number: String(transaction?.order_number || fallback?.order_number || ''),
    currency: String(transaction?.currency || fallback?.currency || 'MYR'),
    amount: String(transaction?.amount ?? fallback?.amount ?? ''),
    payer_name: String(transaction?.payer_name || fallback?.payer_name || ''),
    payer_email: String(transaction?.payer_email || fallback?.payer_email || ''),
    payer_bank_name: String(transaction?.payer_bank_name || ''),
    status: String(transaction?.status ?? ''),
    status_description: String(transaction?.status_description || ''),
    datetime: String(transaction?.datetime || transaction?.created_at || fallback?.paid_at || ''),
  };
}

function successTransaction(transactions = []) {
  return transactions.find((item) => String(item?.status ?? '') === '3') || null;
}

function firstTransaction(transactions = []) {
  return transactions[0] || null;
}

function paidIntentAsTransaction(intent = {}) {
  const id = String(intent?.id || '').trim();
  const orderNumber = String(intent?.order_number || '').trim();
  const amount = String(intent?.amount ?? '').trim();
  if (!id || !orderNumber || !amount) return null;
  return {
    id: `intent:${id}`,
    order_number: orderNumber,
    currency: intent?.currency || 'MYR',
    amount,
    payer_name: intent?.payer_name || '',
    payer_email: intent?.payer_email || '',
    status: 3,
    status_description: 'Payment intent confirmed paid by Bayarcash API',
    datetime: intent?.paid_at || intent?.updated_at || new Date().toISOString(),
  };
}

export async function reconcileSupportPayment({ paymentIntentId = '', orderNumber = '' } = {}) {
  let intent = null;
  let finalOrderNumber = String(orderNumber || '').trim();
  let transaction = null;
  let transactionLookupError = null;
  let attempts = [];

  if (paymentIntentId) {
    intent = await getBayarcashPaymentIntent(paymentIntentId);
    finalOrderNumber = finalOrderNumber || String(intent?.order_number || '').trim();
    attempts = Array.isArray(intent?.attempts) ? intent.attempts : [];
  }

  let transactions = [];
  if (finalOrderNumber) {
    try {
      transactions = await getBayarcashTransactionsByOrderNumber(finalOrderNumber);
    } catch (error) {
      transactionLookupError = error;
      console.warn('[support/reconcile] transaction lookup failed:', error?.code, error?.status, error?.message);
    }
  }

  transaction = successTransaction(transactions)
    || successTransaction(attempts)
    || firstTransaction(transactions)
    || firstTransaction(attempts)
    || null;

  const intentStatus = String(intent?.status || '').trim().toLowerCase();
  if (intentStatus === 'paid' && String(transaction?.status ?? '') !== '3') {
    transaction = paidIntentAsTransaction(intent) || transaction;
  }

  let result = null;
  if (transaction && String(transaction?.order_number || finalOrderNumber || '').trim()) {
    result = await applyBayarcashTransaction(transactionPayload(transaction, intent || {}));
  }

  const transactionStatus = String(transaction?.status ?? '').trim();
  const paid = transactionStatus === '3' || intentStatus === 'paid' || Boolean(result?.paid);

  return {
    paid,
    intentStatus: intentStatus || null,
    transactionStatus: transactionStatus || null,
    paymentIntentId: String(intent?.id || paymentIntentId || ''),
    orderNumber: finalOrderNumber,
    transactionId: String(transaction?.id || transaction?.transaction_id || ''),
    amount: String(transaction?.amount ?? intent?.amount ?? ''),
    statusDescription: String(transaction?.status_description || ''),
    transactionLookupError: transactionLookupError
      ? { code: transactionLookupError?.code || null, status: transactionLookupError?.status || null }
      : null,
    result,
    intent,
    transaction,
  };
}
