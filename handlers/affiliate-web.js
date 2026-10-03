import {
  createAffiliateWithdrawal,
  getAffiliateActivity,
  getAffiliateDashboard,
} from '../src/affiliate/store.js';
import { resolvePushDeviceOwner } from '../src/support/webpush-payment.js';
import { sendMessage, telegram } from '../src/telegram.js';

let botUsernamePromise = null;

function json(res, status, body) {
  return res.status(status).json(body);
}

function bearerToken(req) {
  const raw = String(req?.headers?.authorization || '').trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || req?.headers?.['x-payping-device-token'] || '').trim();
}

async function authenticatedUserId(req) {
  const token = bearerToken(req);
  if (!token) return null;
  return resolvePushDeviceOwner(token);
}

async function botUsername() {
  const configured = String(process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@+/, '');
  if (configured) return configured;

  if (!botUsernamePromise) {
    botUsernamePromise = telegram('getMe', {})
      .then((bot) => String(bot?.username || '').trim().replace(/^@+/, ''))
      .catch((error) => {
        botUsernamePromise = null;
        console.warn('[affiliate-web] getMe failed:', error?.message);
        return '';
      });
  }
  return botUsernamePromise;
}

function referralLink(username, code) {
  return username && code ? `https://t.me/${username}?start=ref_${code}` : '';
}

async function payloadFor(userId) {
  const [dashboard, activity, username] = await Promise.all([
    getAffiliateDashboard({ userId }),
    getAffiliateActivity({ userId, limit: 40 }),
    botUsername(),
  ]);

  const available = Number(dashboard.available || 0);
  const minimum = Number(dashboard.minimumWithdrawal || 0);
  return {
    dashboard,
    activity,
    referralLink: referralLink(username, dashboard.profile?.referralCode),
    withdrawAllowed: Number.isFinite(available) && Number.isFinite(minimum) && available >= minimum,
  };
}

async function notifyWithdrawal(result) {
  if (!result?.created) return;

  const userText = [
    '✅ PayPing Affiliate withdrawal diterima',
    '',
    `Request: ${result.requestId}`,
    `Amount: RM${result.amount}`,
    'Status: Pending',
  ].join('\n');
  await sendMessage(result.userId, userText).catch(() => {});

  const ownerId = Number(process.env.BOT_OWNER_ID || 0);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) return;

  const username = result.username ? `@${result.username}` : '-';
  await sendMessage(ownerId, [
    '💸 PAYPING AFFILIATE WITHDRAWAL',
    '',
    `Request: ${result.requestId}`,
    `User: ${username}`,
    `Telegram ID: ${result.userId}`,
    `Amount: RM${result.amount}`,
    '',
    'Selepas transfer manual:',
    `/affiliatepaid ${result.requestId}`,
    '',
    'Kalau request perlu dibatalkan:',
    `/affiliatereject ${result.requestId}`,
  ].join('\n')).catch((error) => {
    console.warn('[affiliate-web] owner withdrawal notification failed:', error?.message);
  });
}

export default async function handler(req, res) {
  const userId = await authenticatedUserId(req);
  if (!userId) {
    return json(res, 401, {
      ok: false,
      error: 'PAYPING_DEVICE_NOT_AUTHENTICATED',
      message: 'Connect PayPing dengan /pushsetup dahulu.',
    });
  }

  try {
    if (req.method === 'GET') {
      return json(res, 200, { ok: true, ...(await payloadFor(userId)) });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = String(body.action || '').trim().toLowerCase();

    if (action === 'withdraw') {
      const result = await createAffiliateWithdrawal({ userId });
      await notifyWithdrawal(result);
      return json(res, 200, {
        ok: true,
        withdrawal: result,
        ...(await payloadFor(userId)),
      });
    }

    return json(res, 400, { ok: false, error: 'unknown_action' });
  } catch (error) {
    console.error('[affiliate-web] request failed:', error?.code, error?.message);
    return json(res, 500, {
      ok: false,
      error: String(error?.code || 'AFFILIATE_WEB_FAILED'),
      message: error?.message || 'Affiliate request failed.',
    });
  }
}
