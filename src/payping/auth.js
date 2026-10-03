import {
  createHash,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

import { ensureAffiliateProfile } from '../affiliate/store.js';
import { currentSupportEnvironment, getSupportDb } from '../support/store.js';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
let authSchemaPromise = null;

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 254);
}

function cleanName(value) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, 100);
}

function validEmail(value) {
  const email = cleanEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function sessionHash(token) {
  return createHash('sha256')
    .update(`${currentSupportEnvironment()}:payping-session:${String(token || '').trim()}`)
    .digest('hex');
}

function linkCodeHash(code) {
  return createHash('sha256')
    .update(`${currentSupportEnvironment()}:payping-link:${String(code || '').trim()}`)
    .digest('hex');
}

function hashPassword(password) {
  const value = String(password || '');
  if (value.length < 8 || value.length > 200) {
    const error = new Error('Password mesti sekurang-kurangnya 8 aksara.');
    error.code = 'INVALID_PASSWORD';
    throw error;
  }
  const salt = randomBytes(16);
  const digest = scryptSync(value, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

function verifyPassword(password, stored) {
  try {
    const [kind, saltText, digestText] = String(stored || '').split('$');
    if (kind !== 'scrypt' || !saltText || !digestText) return false;
    const expected = Buffer.from(digestText, 'base64url');
    const actual = scryptSync(String(password || ''), Buffer.from(saltText, 'base64url'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function rowToAccount(row) {
  if (!row) return null;
  const telegramUserId = String(row.telegram_user_id || '').trim();
  return {
    accountId: String(row.account_id || ''),
    email: String(row.email || ''),
    displayName: String(row.display_name || ''),
    role: String(row.role || 'user'),
    telegramUserId: telegramUserId || null,
    telegramLinked: Boolean(telegramUserId),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
  };
}

export async function ensurePayPingAuthSchema() {
  if (!authSchemaPromise) {
    authSchemaPromise = (async () => {
      const db = await getSupportDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS payping_accounts (
          environment TEXT NOT NULL,
          account_id TEXT NOT NULL,
          email TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'user',
          telegram_user_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_login_at TEXT,
          PRIMARY KEY (environment, account_id),
          UNIQUE (environment, email),
          UNIQUE (environment, telegram_user_id)
        )`,
        `CREATE TABLE IF NOT EXISTS payping_sessions (
          environment TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          account_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          PRIMARY KEY (environment, token_hash)
        )`,
        `CREATE TABLE IF NOT EXISTS payping_link_codes (
          environment TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          telegram_user_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          used_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          PRIMARY KEY (environment, code_hash)
        )`,
        'CREATE INDEX IF NOT EXISTS idx_payping_sessions_account ON payping_sessions(environment, account_id)',
        'CREATE INDEX IF NOT EXISTS idx_payping_link_codes_user ON payping_link_codes(environment, telegram_user_id)',
      ], 'write');
      return true;
    })().catch((error) => {
      authSchemaPromise = null;
      throw error;
    });
  }
  return authSchemaPromise;
}

async function accountById(db, environment, accountId) {
  const result = await db.execute({
    sql: `SELECT account_id, email, display_name, role, telegram_user_id,
                 created_at, updated_at, last_login_at
          FROM payping_accounts
          WHERE environment = ? AND account_id = ?
          LIMIT 1`,
    args: [environment, String(accountId || '')],
  });
  return rowToAccount(result.rows?.[0] || null);
}

async function createSession(db, environment, accountId) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.execute({
    sql: `INSERT INTO payping_sessions (
            environment, token_hash, account_id, expires_at, created_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      environment,
      sessionHash(token),
      accountId,
      expiresAt.toISOString(),
      now.toISOString(),
      now.toISOString(),
    ],
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function registerPayPingAccount({ email, password, displayName = '' } = {}) {
  await ensurePayPingAuthSchema();
  const normalizedEmail = validEmail(email);
  if (!normalizedEmail) {
    const error = new Error('Email tidak sah.');
    error.code = 'INVALID_EMAIL';
    throw error;
  }

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const existing = await db.execute({
    sql: 'SELECT account_id FROM payping_accounts WHERE environment = ? AND email = ? LIMIT 1',
    args: [environment, normalizedEmail],
  });
  if (existing.rows?.[0]) {
    const error = new Error('Email ini sudah mempunyai akaun PayPing.');
    error.code = 'ACCOUNT_EXISTS';
    throw error;
  }

  const now = new Date().toISOString();
  const accountId = randomBytes(12).toString('base64url');
  const passwordHash = hashPassword(password);
  const name = cleanName(displayName);

  await db.execute({
    sql: `INSERT INTO payping_accounts (
            environment, account_id, email, password_hash, display_name,
            role, telegram_user_id, created_at, updated_at, last_login_at
          ) VALUES (?, ?, ?, ?, ?, 'user', NULL, ?, ?, ?)`,
    args: [environment, accountId, normalizedEmail, passwordHash, name, now, now, now],
  });

  const session = await createSession(db, environment, accountId);
  return {
    account: await accountById(db, environment, accountId),
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAt,
  };
}

export async function loginPayPingAccount({ email, password } = {}) {
  await ensurePayPingAuthSchema();
  const normalizedEmail = validEmail(email);
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();

  const result = normalizedEmail
    ? await db.execute({
      sql: `SELECT account_id, password_hash
            FROM payping_accounts
            WHERE environment = ? AND email = ?
            LIMIT 1`,
      args: [environment, normalizedEmail],
    })
    : { rows: [] };

  const row = result.rows?.[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    const error = new Error('Email atau password tidak betul.');
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  const now = new Date().toISOString();
  await db.execute({
    sql: 'UPDATE payping_accounts SET last_login_at = ?, updated_at = ? WHERE environment = ? AND account_id = ?',
    args: [now, now, environment, String(row.account_id || '')],
  });

  const session = await createSession(db, environment, String(row.account_id || ''));
  return {
    account: await accountById(db, environment, String(row.account_id || '')),
    sessionToken: session.token,
    sessionExpiresAt: session.expiresAt,
  };
}

export async function getPayPingSessionAccount(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  await ensurePayPingAuthSchema();

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `SELECT a.account_id, a.email, a.display_name, a.role, a.telegram_user_id,
                 a.created_at, a.updated_at, a.last_login_at,
                 s.expires_at
          FROM payping_sessions s
          JOIN payping_accounts a
            ON a.environment = s.environment
           AND a.account_id = s.account_id
          WHERE s.environment = ? AND s.token_hash = ?
          LIMIT 1`,
    args: [environment, sessionHash(raw)],
  });
  const row = result.rows?.[0];
  if (!row) return null;

  if (!row.expires_at || new Date(String(row.expires_at)).getTime() <= Date.now()) {
    await db.execute({
      sql: 'DELETE FROM payping_sessions WHERE environment = ? AND token_hash = ?',
      args: [environment, sessionHash(raw)],
    }).catch(() => {});
    return null;
  }

  await db.execute({
    sql: 'UPDATE payping_sessions SET last_seen_at = ? WHERE environment = ? AND token_hash = ?',
    args: [now, environment, sessionHash(raw)],
  }).catch(() => {});

  return rowToAccount(row);
}

export async function logoutPayPingSession(token) {
  const raw = String(token || '').trim();
  if (!raw) return { loggedOut: true };
  await ensurePayPingAuthSchema();
  const db = await getSupportDb();
  await db.execute({
    sql: 'DELETE FROM payping_sessions WHERE environment = ? AND token_hash = ?',
    args: [currentSupportEnvironment(), sessionHash(raw)],
  });
  return { loggedOut: true };
}

export async function createPayPingLinkCode(telegramUserId) {
  await ensurePayPingAuthSchema();
  const userId = String(telegramUserId || '').trim();
  if (!/^\d+$/.test(userId)) {
    const error = new Error('Telegram account tidak sah.');
    error.code = 'INVALID_TELEGRAM_ACCOUNT';
    throw error;
  }

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const code = String(randomInt(10000000, 100000000));
  const hash = linkCodeHash(code);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);

  await db.batch([
    {
      sql: `DELETE FROM payping_link_codes
            WHERE environment = ? AND telegram_user_id = ? AND used_at = ''`,
      args: [environment, userId],
    },
    {
      sql: `INSERT INTO payping_link_codes (
              environment, code_hash, telegram_user_id, expires_at, used_at, created_at
            ) VALUES (?, ?, ?, ?, '', ?)`,
      args: [environment, hash, userId, expiresAt.toISOString(), now.toISOString()],
    },
  ], 'write');

  return { code, expiresAt: expiresAt.toISOString() };
}

export async function linkPayPingTelegram({ accountId, code } = {}) {
  await ensurePayPingAuthSchema();

  const normalizedCode = String(code || '').trim();
  if (!/^\d{8}$/.test(normalizedCode)) {
    const error = new Error('Masukkan setup code 8 digit daripada Telegram.');
    error.code = 'INVALID_SETUP_CODE';
    throw error;
  }

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  const hash = linkCodeHash(normalizedCode);

  const account = await accountById(db, environment, accountId);
  if (!account) {
    const error = new Error('Akaun PayPing tidak dijumpai.');
    error.code = 'ACCOUNT_NOT_FOUND';
    throw error;
  }

  const codeResult = await db.execute({
    sql: `SELECT telegram_user_id, expires_at, used_at
          FROM payping_link_codes
          WHERE environment = ? AND code_hash = ?
          LIMIT 1`,
    args: [environment, hash],
  });
  const row = codeResult.rows?.[0];
  if (!row || row.used_at || !row.expires_at || new Date(String(row.expires_at)).getTime() <= Date.now()) {
    const error = new Error('Setup code expired atau tidak sah. Generate /pushsetup baru.');
    error.code = 'SETUP_CODE_EXPIRED';
    throw error;
  }

  const telegramUserId = String(row.telegram_user_id || '').trim();
  if (!/^\d+$/.test(telegramUserId)) {
    const error = new Error('Telegram account tidak sah.');
    error.code = 'INVALID_TELEGRAM_ACCOUNT';
    throw error;
  }

  const conflict = await db.execute({
    sql: `SELECT account_id
          FROM payping_accounts
          WHERE environment = ? AND telegram_user_id = ? AND account_id <> ?
          LIMIT 1`,
    args: [environment, telegramUserId, String(accountId || '')],
  });
  if (conflict.rows?.[0]) {
    const error = new Error('Telegram account ini sudah linked dengan akaun PayPing lain.');
    error.code = 'TELEGRAM_ALREADY_LINKED';
    throw error;
  }

  const consume = await db.execute({
    sql: `UPDATE payping_link_codes
          SET used_at = ?
          WHERE environment = ? AND code_hash = ? AND used_at = '' AND expires_at > ?`,
    args: [now, environment, hash, now],
  });
  if (Number(consume.rowsAffected || 0) !== 1) {
    const error = new Error('Setup code sudah digunakan. Generate /pushsetup baru.');
    error.code = 'SETUP_CODE_ALREADY_USED';
    throw error;
  }

  const ownerId = String(process.env.BOT_OWNER_ID || '').trim();
  const role = ownerId && telegramUserId === ownerId ? 'admin' : 'user';

  await db.execute({
    sql: `UPDATE payping_accounts
          SET telegram_user_id = ?, role = ?, updated_at = ?
          WHERE environment = ? AND account_id = ?`,
    args: [telegramUserId, role, now, environment, String(accountId || '')],
  });

  await ensureAffiliateProfile({ userId: telegramUserId }).catch((error) => {
    console.warn('[payping-auth] affiliate profile init failed:', error?.message);
  });

  return accountById(db, environment, accountId);
}
