import {
  getAffiliateAdminDashboard,
  markAffiliateWithdrawal,
} from '../src/affiliate/store.js';
import { resolvePayPingIdentity } from '../src/payping/identity.js';
import { sendMessage } from '../src/telegram.js';

function json(res, status, body) { return res.status(status).json(body); }

function bearerToken(req) {
  const raw = String(req?.headers?.authorization || '').trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || req?.headers?.['x-payping-device-token'] || '').trim();
}

async function ownerAuth(req) {
  const identity = await resolvePayPingIdentity(req);
  if (!identity) return { ok: false, status: 401, reason: 'not_authenticated' };
  if (!identity.owner) return { ok: false, status: 403, reason: 'owner_only' };
  return { ok: true, userId: identity.userId, role: identity.role };
}

async function notifyAffiliateUser(result) {
  if (!result?.updated || !result?.userId) return;
  await sendMessage(
    result.userId,
    result.status === 'PAID'
      ? `✅ PayPing Affiliate payout RM${result.amount} telah ditandakan PAID.\nRequest: ${result.requestId}`
      : `↩️ Withdrawal RM${result.amount} dibatalkan. Amount telah kembali ke Available wallet.\nRequest: ${result.requestId}`,
  ).catch((error) => {
    console.warn('[affiliate-admin] user payout notification failed:', error?.message);
  });
}

export default async function handler(req, res) {
  const auth = await ownerAuth(req);
  if (!auth.ok) {
    return json(res, auth.status, { ok: false, error: auth.reason });
  }

  try {
    if (req.method === 'GET') {
      return json(res, 200, { ok: true, ...(await getAffiliateAdminDashboard({ limit: 100 })) });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = String(body.action || '').trim().toLowerCase();

    if (action === 'finalize_withdrawal') {
      const requestId = String(body.requestId || '').trim().toUpperCase();
      const decision = String(body.decision || '').trim().toUpperCase();
      if (!requestId || !['PAID', 'REJECTED'].includes(decision)) {
        return json(res, 400, { ok: false, error: 'invalid_withdrawal_action' });
      }

      const result = await markAffiliateWithdrawal(requestId, decision);
      await notifyAffiliateUser(result);
      return json(res, 200, {
        ok: true,
        result,
        ...(await getAffiliateAdminDashboard({ limit: 100 })),
      });
    }

    return json(res, 400, { ok: false, error: 'unknown_action' });
  } catch (error) {
    console.error('[affiliate-admin] request failed:', error?.code, error?.message);
    return json(res, 500, {
      ok: false,
      error: String(error?.code || 'AFFILIATE_ADMIN_FAILED'),
      message: error?.message || 'Affiliate admin request failed.',
    });
  }
}
