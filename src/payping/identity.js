import { getPayPingSessionAccount } from './auth.js';
import { resolvePushDeviceOwner } from '../support/webpush-payment.js';

export function payPingBearerToken(req) {
  const raw = String(req?.headers?.authorization || '').trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || req?.headers?.['x-payping-device-token'] || '').trim();
}

export async function resolvePayPingIdentity(req) {
  const token = payPingBearerToken(req);
  if (!token) return null;

  const account = await getPayPingSessionAccount(token).catch(() => null);
  if (account) {
    const userId = String(account.telegramUserId || '').trim() || null;
    const ownerId = String(process.env.BOT_OWNER_ID || '').trim();
    const owner = account.role === 'admin' || Boolean(userId && ownerId && userId === ownerId);
    return {
      token,
      authType: 'session',
      accountId: account.accountId,
      account,
      userId,
      role: owner ? 'admin' : 'user',
      owner,
      telegramLinked: Boolean(userId),
    };
  }

  const userId = await resolvePushDeviceOwner(token);
  if (!userId) return null;
  const ownerId = String(process.env.BOT_OWNER_ID || '').trim();
  const owner = Boolean(ownerId && String(userId) === ownerId);
  return {
    token,
    authType: 'device',
    accountId: null,
    account: null,
    userId: String(userId),
    role: owner ? 'admin' : 'user',
    owner,
    telegramLinked: true,
  };
}
