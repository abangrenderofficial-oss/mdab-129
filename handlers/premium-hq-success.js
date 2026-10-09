import { createHmac, timingSafeEqual } from 'node:crypto';

import { recordPremiumHqSuccess } from '../src/support/premium-hq-completion.js';

function json(res, status, body) {
  return res.status(status).json(body);
}

function positiveId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function signedChatId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id !== 0 ? id : 0;
}

function validSignature(provided, expected) {
  const left = Buffer.from(String(provided || '').trim().toLowerCase(), 'utf8');
  const right = Buffer.from(String(expected || '').trim().toLowerCase(), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return json(res, 503, { ok: false, error: 'bot_token_missing' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const chatId = signedChatId(body.chat_id);
  const userId = positiveId(body.user_id);
  const event = String(body.event || '').trim();
  const completionKey = String(body.completion_key || '').trim().slice(0, 240);
  if (!chatId || !userId || event !== 'status_hq') {
    return json(res, 400, { ok: false, error: 'invalid_payload' });
  }

  const payload = completionKey
    ? `${chatId}:${userId}:status_hq:${completionKey}:v2`
    : `${chatId}:${userId}:status_hq:v1`;
  const expected = createHmac('sha256', token).update(payload).digest('hex');
  const provided = req.headers['x-heavy-worker-signature'];
  if (!validSignature(provided, expected)) {
    return json(res, 401, { ok: false, error: 'invalid_signature' });
  }

  const completion = await recordPremiumHqSuccess({
    userId,
    chatId,
    label: 'premium hq heavy worker',
    completionKey,
  });

  return json(res, 200, {
    ok: true,
    premium_hq_completed: true,
    daily_force_marked: Boolean(completion?.dailyMarked),
    friday_marked: Boolean(completion?.fridayMarked),
    channel_prompted: Boolean(completion?.channelPrompted),
    channel_counted: Boolean(completion?.channelCounted),
  });
}
