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

function selectBestTransaction(transactions = []) {
  if (!transactions.length) return null;
  return transactions.find((item) => String(item?.status ?? '') === '3')
    || transactions[0]
    || null;
}

export async function reconcileSupportPayment({ paymentIntentId = '', orderNumber = '' } = {}) {
  let intent = null;
  let finalOrderNumber = String(orderNumber || '').trim();
  let transaction = null;

  if (paymentIntentId) {
    intent = await getBayarcashPaymentIntent(paymentIntentId);
    finalOrderNumber = finalOrderNumber || String(intent?.order_number || '').trim();
    const attempts = Array.isArray(intent?.attempts) ? intent.attempts : [];
    transaction = selectBestTransaction(attempts);
  }

  if (!transaction && finalOrderNumber) {
    const transactions = await getBayarcashTransactionsByOrderNumber(finalOrderNumber);
    transaction = selectBestTransaction(transactions);
  }

  let result = null;
  if (transaction) {
    result = await applyBayarcashTransaction(transactionPayload(transaction, intent || {}));
  }

  const intentStatus = String(intent?.status || '').trim().toLowerCase();
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
    result,
    intent,
    transaction,
  };
}
