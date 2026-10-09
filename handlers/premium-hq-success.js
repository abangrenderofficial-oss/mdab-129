import { authenticateHeavyHqCompletion } from '../src/support/heavy-hq-callback-auth.js';
import { recordPremiumHqSuccess } from '../src/support/premium-hq-completion.js';

function json(res, status, body) {
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  const auth = authenticateHeavyHqCompletion({
    method: req.method,
    token: String(process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    body: req.body,
    signature: req.headers?.['x-heavy-worker-signature'],
  });
  if (!auth.ok) {
    if (auth.status === 405) res.setHeader('Allow', 'POST');
    return json(res, auth.status, {ok:false,error:auth.error});
  }

  const completion = await recordPremiumHqSuccess({
    userId: auth.userId,
    chatId: auth.chatId,
    label: 'premium hq heavy worker',
    completionKey: auth.completionKey,
  });
  return json(res, 200, {
    ok: true,
    premium_hq_completed: true,
    duplicate: Boolean(completion?.duplicate),
    daily_force_marked: Boolean(completion?.dailyMarked),
    friday_marked: Boolean(completion?.fridayMarked),
    channel_prompted: Boolean(completion?.channelPrompted),
    channel_counted: Boolean(completion?.channelCounted),
  });
}
