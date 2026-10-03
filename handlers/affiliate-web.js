import {
  createAffiliateWithdrawal,
  getAffiliateActivity,
  getAffiliateDashboard,
  getAffiliatePayoutProfile,
  saveAffiliatePayoutProfile,
} from '../src/affiliate/store.js';
import { resolvePayPingIdentity } from '../src/payping/auth.js';
import { sendMessage, telegram } from '../src/telegram.js';

let botUsernamePromise = null;

function json(res, status, body) {
  return res.status(status).json(body);
}

async function authenticatedIdentity(req) {
  return resolvePayPingIdentity(req, { allowLegacyDevice: true });
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
  const [dashboard, activity, payoutProfile, username] = await Promise.all([
    getAffiliateDashboard({ userId }),
    getAffiliateActivity({ userId, limit: 40 }),
    getAffiliatePayoutProfile({ userId }),
    botUsername(),
  ]);

  const available = Number(dashboard.available || 0);
  const minimum = Number(dashboard.minimumWithdrawal || 0);
  return {
    dashboard,
    activity,
    payoutProfile,
    referralLink: referralLink(username, dashboard.profile?.referralCode),
    withdrawAllowed: Number.isFinite(available)
      && Number.isFinite(minimum)
      && available >= minimum
      && payoutProfile?.configured === true
      && payoutProfile?.readable !== false,
  };
}

async function notifyWithdrawal(result) {
  if (!result?.created) return;
  const payout = await getAffiliatePayoutProfile({ userId: result.userId }).catch(() => null);

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
    `Payout: ${payout?.displayHint || 'Belum configured'}`,
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
  const identity = await authenticatedIdentity(req);
  if (!identity) {
    return json(res, 401, {
      ok: false,
      error: 'PAYPING_LOGIN_REQUIRED',
      message: 'Login PayPing dahulu.',
    });
  }
  if (!identity.userId) {
    return json(res, 409, {
      ok: false,
      error: 'PAYPING_TELEGRAM_LINK_REQUIRED',
      message: 'Connect Telegram dahulu.',
    });
  }
  if (identity.source === 'account_session' && !['affiliate','admin','owner'].includes(String(identity.role || ''))) {
    return json(res, 403, {
      ok: false,
      error: 'PAYPING_AFFILIATE_REQUIRED',
      message: 'Join PayPing Affiliate dahulu.',
    });
  }
  const userId = identity.userId;

  try {
    if (req.method === 'GET') {
      return json(res, 200, { ok: true, role: identity.role, owner: identity.owner, ...(await payloadFor(userId)) });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = String(body.action || '').trim().toLowerCase();

    if (action === 'save_payout') {
      const payoutProfile = await saveAffiliatePayoutProfile({
        userId,
        payout: body.payout || {},
      });
      return json(res, 200, {
        ok: true,
        payoutProfile,
        ...(await payloadFor(userId)),
      });
    }

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
    const status = error?.code === 'INVALID_PAYOUT_PROFILE' ? 400 : 500;
    return json(res, status, {
      ok: false,
      error: String(error?.code || 'AFFILIATE_WEB_FAILED'),
      message: error?.message || 'Affiliate request failed.',
    });
  }
}
