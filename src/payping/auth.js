import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { currentSupportEnvironment, getSupportDb } from '../support/store.js';
import { resolvePushDeviceOwner } from '../support/webpush-payment.js';

const scrypt = promisify(scryptCb);
const SESSION_COOKIE = 'payping_session_v1';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
let schemaPromise = null;

function clean(value, max = 200) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizeEmail(value) {
  return clean(value, 254).toLowerCase();
}

function validEmail(value) {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function sessionHash(token) {
  return createHash('sha256').update('payping:session:'+String(token || '')).digest('hex');
}

async function passwordHash(password, salt) {
  const pepper = String(process.env.PAYPING_AUTH_PEPPER || '');
  return Buffer.from(await scrypt(String(password || '') + pepper, String(salt || ''), 64)).toString('hex');
}

function accountFromRow(row) {
  if (!row) return null;
  return {
    accountId: String(row.account_id || ''),
    email: String(row.email || ''),
    displayName: String(row.display_name || ''),
    role: String(row.role || 'user'),
    telegramUserId: String(row.telegram_user_id || ''),
    status: String(row.status || 'active'),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    lastLoginAt: String(row.last_login_at || ''),
  };
}

async function affiliateExists(userId) {
  if (!/^\d+$/.test(String(userId || ''))) return false;
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT 1 FROM affiliate_profiles WHERE environment = ? AND telegram_user_id = ? LIMIT 1`,
    args: [currentSupportEnvironment(), String(userId)],
  });
  return Boolean(result.rows?.length);
}

export async function ensurePayPingAuthSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS payping_accounts (
          account_id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL DEFAULT '',
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          telegram_user_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_login_at TEXT NOT NULL DEFAULT ''
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_payping_accounts_telegram
          ON payping_accounts(telegram_user_id)
          WHERE telegram_user_id <> ''`,
        `CREATE TABLE IF NOT EXISTS payping_sessions (
          session_hash TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          revoked_at TEXT NOT NULL DEFAULT ''
        )`,
        `CREATE INDEX IF NOT EXISTS idx_payping_sessions_account
          ON payping_sessions(account_id, revoked_at, expires_at)`,
        `CREATE TABLE IF NOT EXISTS payping_telegram_link_codes (
          code_hash TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          used_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_payping_link_codes_account
          ON payping_telegram_link_codes(account_id, used_at, expires_at)`,
      ], 'write');
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function createPayPingAccount({
  email,
  password,
  displayName = '',
  trustedTelegramUserId = '',
  role = 'user',
} = {}) {
  await ensurePayPingAuthSchema();
  const normalized = validEmail(email);
  const secret = String(password || '');
  if (!normalized) {
    const error = new Error('Email tidak sah.');
    error.code = 'INVALID_EMAIL';
    throw error;
  }
  if (secret.length < 8 || secret.length > 128) {
    const error = new Error('Password mesti 8 hingga 128 aksara.');
    error.code = 'INVALID_PASSWORD';
    throw error;
  }

  const allowedRole = ['user','affiliate','admin','owner'].includes(role) ? role : 'user';
  const telegramUserId = /^\d+$/.test(String(trustedTelegramUserId || '')) ? String(trustedTelegramUserId) : '';
  const db = await getSupportDb();
  const now = new Date().toISOString();
  const accountId = 'ppa_' + randomBytes(18).toString('base64url');
  const salt = randomBytes(18).toString('base64url');
  const hash = await passwordHash(secret, salt);
  let finalRole = allowedRole;
  if (finalRole === 'user' && telegramUserId && await affiliateExists(telegramUserId)) finalRole = 'affiliate';

  try {
    await db.execute({
      sql: `INSERT INTO payping_accounts (
              account_id,email,display_name,password_salt,password_hash,role,
              telegram_user_id,status,created_at,updated_at,last_login_at
            ) VALUES (?,?,?,?,?,?,?,'active',?,?,?)`,
      args: [
        accountId,
        normalized,
        clean(displayName, 80),
        salt,
        hash,
        finalRole,
        telegramUserId,
        now,
        now,
        now,
      ],
    });
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    const e = new Error(message.includes('telegram_user_id')
      ? 'Telegram account ini sudah linked dengan PayPing account lain.'
      : 'Email ini sudah digunakan.');
    e.code = message.includes('telegram_user_id') ? 'TELEGRAM_ALREADY_LINKED' : 'EMAIL_ALREADY_EXISTS';
    throw e;
  }

  return {
    accountId,
    email: normalized,
    displayName: clean(displayName, 80),
    role: finalRole,
    telegramUserId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
}

export async function authenticatePayPingAccount(email, password) {
  await ensurePayPingAuthSchema();
  const normalized = validEmail(email);
  const secret = String(password || '');
  if (!normalized || !secret) return null;

  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT account_id,email,display_name,password_salt,password_hash,role,
                 telegram_user_id,status,created_at,updated_at,last_login_at
          FROM payping_accounts WHERE email = ? LIMIT 1`,
    args: [normalized],
  });
  const row = result.rows?.[0];
  if (!row || String(row.status || '') !== 'active') return null;

  const expected = Buffer.from(String(row.password_hash || ''), 'hex');
  const actual = Buffer.from(await passwordHash(secret, String(row.password_salt || '')), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE payping_accounts SET last_login_at = ?, updated_at = ? WHERE account_id = ?`,
    args: [now, now, String(row.account_id || '')],
  });
  row.last_login_at = now;
  row.updated_at = now;
  return accountFromRow(row);
}

export async function linkTrustedTelegram(accountId, telegramUserId, { promoteOwner = false } = {}) {
  const id = String(accountId || '').trim();
  const userId = /^\d+$/.test(String(telegramUserId || '')) ? String(telegramUserId) : '';
  if (!id || !userId) return null;

  await ensurePayPingAuthSchema();
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT account_id,email,display_name,role,telegram_user_id,status,created_at,updated_at,last_login_at
          FROM payping_accounts WHERE account_id = ? LIMIT 1`,
    args: [id],
  });
  const row = result.rows?.[0];
  if (!row) return null;

  const existing = String(row.telegram_user_id || '');
  if (existing && existing !== userId) {
    const error = new Error('PayPing account ini sudah linked dengan Telegram account lain.');
    error.code = 'ACCOUNT_ALREADY_LINKED';
    throw error;
  }

  let role = String(row.role || 'user');
  if (promoteOwner) role = 'owner';
  else if (role === 'user' && await affiliateExists(userId)) role = 'affiliate';

  const now = new Date().toISOString();
  try {
    await db.execute({
      sql: `UPDATE payping_accounts
            SET telegram_user_id = ?, role = ?, updated_at = ?
            WHERE account_id = ?`,
      args: [userId, role, now, id],
    });
  } catch {
    const error = new Error('Telegram account ini sudah linked dengan PayPing account lain.');
    error.code = 'TELEGRAM_ALREADY_LINKED';
    throw error;
  }

  row.telegram_user_id = userId;
  row.role = role;
  row.updated_at = now;
  return accountFromRow(row);
}

export async function createPayPingTelegramLinkCode(accountId) {
  const id = String(accountId || '').trim();
  if (!id) {
    const error = new Error('PayPing account missing.');
    error.code = 'PAYPING_ACCOUNT_MISSING';
    throw error;
  }

  await ensurePayPingAuthSchema();
  const db = await getSupportDb();
  const accountResult = await db.execute({
    sql: `SELECT account_id, telegram_user_id FROM payping_accounts WHERE account_id = ? AND status = 'active' LIMIT 1`,
    args: [id],
  });
  const account = accountResult.rows?.[0];
  if (!account) {
    const error = new Error('PayPing account tidak dijumpai.');
    error.code = 'PAYPING_ACCOUNT_NOT_FOUND';
    throw error;
  }
  if (String(account.telegram_user_id || '')) {
    return { alreadyLinked: true, telegramUserId: String(account.telegram_user_id) };
  }

  const code = randomBytes(6).toString('hex').toUpperCase();
  const hash = createHash('sha256').update('payping:telegram-link:'+code).digest('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

  await db.batch([
    {
      sql: `DELETE FROM payping_telegram_link_codes
            WHERE account_id = ? AND used_at = ''`,
      args: [id],
    },
    {
      sql: `INSERT INTO payping_telegram_link_codes (
              code_hash, account_id, expires_at, used_at, created_at
            ) VALUES (?, ?, ?, '', ?)`,
      args: [hash, id, expiresAt.toISOString(), now.toISOString()],
    },
  ], 'write');

  return { code, expiresAt: expiresAt.toISOString(), alreadyLinked: false };
}

export async function consumePayPingTelegramLinkCode(code, telegramUserId) {
  const normalized = String(code || '').trim().toUpperCase();
  const userId = /^\d+$/.test(String(telegramUserId || '')) ? String(telegramUserId) : '';
  if (!/^[A-F0-9]{12}$/.test(normalized) || !userId) {
    const error = new Error('PayPing link code tidak sah.');
    error.code = 'INVALID_PAYPING_LINK_CODE';
    throw error;
  }

  await ensurePayPingAuthSchema();
  const db = await getSupportDb();
  const hash = createHash('sha256').update('payping:telegram-link:'+normalized).digest('hex');
  const now = new Date().toISOString();
  const found = await db.execute({
    sql: `SELECT account_id, expires_at, used_at
          FROM payping_telegram_link_codes
          WHERE code_hash = ?
          LIMIT 1`,
    args: [hash],
  });
  const row = found.rows?.[0];
  if (!row || row.used_at || !row.expires_at || new Date(String(row.expires_at)).getTime() <= Date.now()) {
    const error = new Error('PayPing link expired atau sudah digunakan.');
    error.code = 'PAYPING_LINK_EXPIRED';
    throw error;
  }

  const claim = await db.execute({
    sql: `UPDATE payping_telegram_link_codes
          SET used_at = ?
          WHERE code_hash = ? AND used_at = '' AND expires_at > ?`,
    args: [now, hash, now],
  });
  if (Number(claim.rowsAffected || 0) !== 1) {
    const error = new Error('PayPing link sudah digunakan.');
    error.code = 'PAYPING_LINK_ALREADY_USED';
    throw error;
  }

  return linkTrustedTelegram(String(row.account_id || ''), userId);
}

export async function promotePayPingAccountToAffiliate(accountId) {
  const id = String(accountId || '').trim();
  if (!id) return null;
  await ensurePayPingAuthSchema();
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT account_id,email,display_name,role,telegram_user_id,status,created_at,updated_at,last_login_at
          FROM payping_accounts WHERE account_id = ? LIMIT 1`,
    args: [id],
  });
  const row = result.rows?.[0];
  if (!row) return null;
  const telegramUserId = String(row.telegram_user_id || '');
  if (!telegramUserId) {
    const error = new Error('Connect Telegram dahulu sebelum join affiliate.');
    error.code = 'PAYPING_TELEGRAM_LINK_REQUIRED';
    throw error;
  }

  const role = String(row.role || 'user');
  if (!['owner','admin','affiliate'].includes(role)) {
    const now = new Date().toISOString();
    await db.execute({
      sql: `UPDATE payping_accounts SET role = 'affiliate', updated_at = ? WHERE account_id = ?`,
      args: [now, id],
    });
    row.role = 'affiliate';
    row.updated_at = now;
  }
  return accountFromRow(row);
}


export async function issuePayPingSession(accountId) {
  await ensurePayPingAuthSchema();
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  const db = await getSupportDb();
  await db.execute({
    sql: `INSERT INTO payping_sessions (
            session_hash,account_id,expires_at,created_at,last_seen_at,revoked_at
          ) VALUES (?,?,?,?,?,'')`,
    args: [sessionHash(token), String(accountId || ''), expires.toISOString(), now.toISOString(), now.toISOString()],
  });
  return { token, expiresAt: expires.toISOString() };
}

export function payPingSessionCookie(token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${encodeURIComponent(String(token || ''))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearPayPingSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function cookies(req) {
  const raw = String(req?.headers?.cookie || '');
  const out = {};
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0,index).trim();
    const value = part.slice(index+1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function payPingSessionTokenFromRequest(req) {
  return String(cookies(req)[SESSION_COOKIE] || '').trim();
}

export async function resolvePayPingSession(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  await ensurePayPingAuthSchema();
  const db = await getSupportDb();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `SELECT a.account_id,a.email,a.display_name,a.role,a.telegram_user_id,a.status,
                 a.created_at,a.updated_at,a.last_login_at,
                 s.expires_at,s.revoked_at
          FROM payping_sessions s
          JOIN payping_accounts a ON a.account_id = s.account_id
          WHERE s.session_hash = ? AND s.revoked_at = '' AND s.expires_at > ?
          LIMIT 1`,
    args: [sessionHash(raw), now],
  });
  const row = result.rows?.[0];
  if (!row || String(row.status || '') !== 'active') return null;

  await db.execute({
    sql: `UPDATE payping_sessions SET last_seen_at = ? WHERE session_hash = ?`,
    args: [now, sessionHash(raw)],
  }).catch(() => {});
  return accountFromRow(row);
}

export async function revokePayPingSession(token) {
  const raw = String(token || '').trim();
  if (!raw) return false;
  await ensurePayPingAuthSchema();
  const db = await getSupportDb();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `UPDATE payping_sessions SET revoked_at = ?, last_seen_at = ?
          WHERE session_hash = ? AND revoked_at = ''`,
    args: [now, now, sessionHash(raw)],
  });
  return Number(result.rowsAffected || 0) > 0;
}

function legacyDeviceToken(req) {
  const raw = String(req?.headers?.['x-payping-device-token'] || '').trim();
  if (raw) return raw;
  const auth = String(req?.headers?.authorization || '').trim().match(/^Bearer\s+(.+)$/i);
  return String(auth?.[1] || '').trim();
}

export async function trustedTelegramFromRequest(req) {
  const token = legacyDeviceToken(req);
  if (!token) return null;
  const userId = await resolvePushDeviceOwner(token);
  if (!userId) return null;
  const ownerId = String(process.env.BOT_OWNER_ID || '').trim();
  return {
    userId: String(userId),
    owner: Boolean(ownerId && String(userId) === ownerId),
  };
}

export async function resolvePayPingIdentity(req, { allowLegacyDevice = true } = {}) {
  const sessionToken = payPingSessionTokenFromRequest(req);
  if (sessionToken) {
    const account = await resolvePayPingSession(sessionToken);
    if (account) {
      return {
        source: 'account_session',
        account,
        accountId: account.accountId,
        email: account.email,
        role: account.role,
        userId: account.telegramUserId,
        owner: ['owner','admin'].includes(account.role),
        needsTelegramLink: !account.telegramUserId,
      };
    }
  }

  if (!allowLegacyDevice) return null;
  const legacy = await trustedTelegramFromRequest(req);
  if (!legacy) return null;
  return {
    source: 'legacy_device',
    account: null,
    accountId: '',
    email: '',
    role: legacy.owner ? 'owner' : 'user',
    userId: legacy.userId,
    owner: legacy.owner,
    needsTelegramLink: false,
  };
}
