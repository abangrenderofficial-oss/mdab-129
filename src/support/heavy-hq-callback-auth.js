import { createHmac, timingSafeEqual } from 'node:crypto';

// Pure callback authentication. No database access, Telegram sends or writes.
// The GitHub heavy worker uses TELEGRAM_BOT_TOKEN as the HMAC signing secret.
function positiveUserId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}
function signedTelegramChatId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id !== 0 ? id : 0;
}
function timingSafeMatch(provided, expected) {
  const left = Buffer.from(String(provided || '').trim().toLowerCase(), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return Boolean(left.length && left.length === right.length && timingSafeEqual(left, right));
}
export function signHeavyHqCompletion(token, { chatId, userId, completionKey = '' }) {
  const key = String(completionKey || '').trim().slice(0, 240);
  const payload = key
    ? `${chatId}:${userId}:status_hq:${key}:v2`
    : `${chatId}:${userId}:status_hq:v1`;
  return createHmac('sha256', String(token || '')).update(payload).digest('hex');
}
export function authenticateHeavyHqCompletion({ method, token, body, signature }) {
  if (method !== 'POST') return { ok: false, status: 405, error: 'method_not_allowed' };
  if (!token) return { ok: false, status: 503, error: 'bot_token_missing' };
  const data = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const chatId = signedTelegramChatId(data.chat_id);
  const userId = positiveUserId(data.user_id);
  const completionKey = String(data.completion_key || '').trim().slice(0, 240);
  if (!chatId || !userId || data.event !== 'status_hq')
    return { ok: false, status: 400, error: 'invalid_payload' };
  const expected = signHeavyHqCompletion(token, { chatId, userId, completionKey });
  if (!timingSafeMatch(signature, expected))
    return { ok: false, status: 401, error: 'invalid_signature' };
  return { ok: true, status: 200, chatId, userId, completionKey };
}
