import {
  getPayPingSessionAccount,
  linkPayPingTelegram,
  loginPayPingAccount,
  logoutPayPingSession,
  registerPayPingAccount,
} from '../src/payping/auth.js';

function json(res, status, body) {
  return res.status(status).json(body);
}

function bearer(req) {
  const raw = String(req?.headers?.authorization || '').trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || '').trim();
}

function publicAccount(account) {
  if (!account) return null;
  return {
    accountId: account.accountId,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    telegramUserId: account.telegramUserId,
    telegramLinked: account.telegramLinked,
    isAdmin: account.role === 'admin',
  };
}

function statusFor(error) {
  const code = String(error?.code || '');
  if (['INVALID_EMAIL', 'INVALID_PASSWORD', 'INVALID_SETUP_CODE'].includes(code)) return 400;
  if (['INVALID_CREDENTIALS'].includes(code)) return 401;
  if (['ACCOUNT_EXISTS', 'TELEGRAM_ALREADY_LINKED'].includes(code)) return 409;
  if (['SETUP_CODE_EXPIRED', 'SETUP_CODE_ALREADY_USED'].includes(code)) return 400;
  return 500;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const account = await getPayPingSessionAccount(bearer(req));
      if (!account) return json(res, 401, { ok: false, error: 'NOT_AUTHENTICATED' });
      return json(res, 200, { ok: true, account: publicAccount(account) });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = String(body.action || '').trim().toLowerCase();

    if (action === 'register') {
      const result = await registerPayPingAccount({
        email: body.email,
        password: body.password,
        displayName: body.displayName,
      });
      return json(res, 201, {
        ok: true,
        account: publicAccount(result.account),
        sessionToken: result.sessionToken,
        sessionExpiresAt: result.sessionExpiresAt,
      });
    }

    if (action === 'login') {
      const result = await loginPayPingAccount({
        email: body.email,
        password: body.password,
      });
      return json(res, 200, {
        ok: true,
        account: publicAccount(result.account),
        sessionToken: result.sessionToken,
        sessionExpiresAt: result.sessionExpiresAt,
      });
    }

    if (action === 'logout') {
      await logoutPayPingSession(bearer(req));
      return json(res, 200, { ok: true, loggedOut: true });
    }

    if (action === 'link_telegram') {
      const token = bearer(req);
      const account = await getPayPingSessionAccount(token);
      if (!account) return json(res, 401, { ok: false, error: 'NOT_AUTHENTICATED' });
      const linked = await linkPayPingTelegram({
        accountId: account.accountId,
        code: body.code,
      });
      return json(res, 200, { ok: true, account: publicAccount(linked) });
    }

    return json(res, 400, { ok: false, error: 'unknown_action' });
  } catch (error) {
    console.warn('[payping-auth] request failed:', error?.code, error?.message);
    return json(res, statusFor(error), {
      ok: false,
      error: String(error?.code || 'PAYPING_AUTH_FAILED'),
      message: error?.message || 'Authentication failed.',
    });
  }
}
