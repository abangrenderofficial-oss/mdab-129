import { normalizeBayarcashPayerName } from '../src/payments/bayarcash.js';

function assert(value, message) {
  if (!value) throw new Error(message);
}

assert(normalizeBayarcashPayerName({ first_name: 'Abang', last_name: 'Render' }) === 'Abang Render', 'normal name failed');
assert(normalizeBayarcashPayerName({ first_name: '\u200B\u200D', username: 'user_name' }) === 'user name', 'invisible Telegram name fallback failed');
assert(normalizeBayarcashPayerName({ first_name: '😊', username: '' }) === 'Telegram Supporter', 'emoji-only fallback failed');
assert(normalizeBayarcashPayerName({ first_name: '  A  ', last_name: ' B ' }) === 'A B', 'whitespace normalization failed');
assert(normalizeBayarcashPayerName({ first_name: '', username: '__' }) === 'Telegram Supporter', 'empty fallback failed');

console.log('BAYARCASH_PAYER_NAME_SELFTEST_OK');
