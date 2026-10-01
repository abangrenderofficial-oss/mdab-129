import { currentSupportEnvironment, getSupportDb } from './store.js';

let schemaPromise = null;

function validUserId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : '';
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

async function ensureLuahRasaSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.execute(`CREATE TABLE IF NOT EXISTS luahrasa_sessions (
        environment TEXT NOT NULL,
        telegram_user_id TEXT NOT NULL,
        state TEXT NOT NULL,
        luahan TEXT NOT NULL DEFAULT '',
        tier_label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (environment, telegram_user_id)
      )`);
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function rowToSession(row) {
  if (!row) return null;
  return {
    userId: String(row.telegram_user_id || ''),
    state: String(row.state || ''),
    luahan: String(row.luahan || ''),
    tierLabel: String(row.tier_label || ''),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

export async function startLuahRasaSession(userId, tierLabel = '') {
  const key = validUserId(userId);
  if (!key) return null;
  await ensureLuahRasaSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO luahrasa_sessions (
            environment, telegram_user_id, state, luahan, tier_label, created_at, updated_at
          ) VALUES (?, ?, 'AWAITING_MESSAGE', '', ?, ?, ?)
          ON CONFLICT(environment, telegram_user_id) DO UPDATE SET
            state = 'AWAITING_MESSAGE',
            luahan = '',
            tier_label = excluded.tier_label,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at`,
    args: [environment, key, cleanText(tierLabel, 100), now, now],
  });

  return getLuahRasaSession(key);
}

export async function getLuahRasaSession(userId) {
  const key = validUserId(userId);
  if (!key) return null;
  await ensureLuahRasaSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT telegram_user_id, state, luahan, tier_label, created_at, updated_at
          FROM luahrasa_sessions
          WHERE environment = ? AND telegram_user_id = ?
          LIMIT 1`,
    args: [environment, key],
  });
  return rowToSession(result.rows?.[0] || null);
}

export async function setLuahRasaMessage(userId, luahan) {
  const key = validUserId(userId);
  if (!key) return null;
  await ensureLuahRasaSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();

  await db.execute({
    sql: `UPDATE luahrasa_sessions
          SET luahan = ?, state = 'AWAITING_NAME', updated_at = ?
          WHERE environment = ? AND telegram_user_id = ?
            AND state = 'AWAITING_MESSAGE'`,
    args: [cleanText(luahan, 1500), now, environment, key],
  });
  return getLuahRasaSession(key);
}

export async function clearLuahRasaSession(userId) {
  const key = validUserId(userId);
  if (!key) return false;
  await ensureLuahRasaSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  await db.execute({
    sql: `DELETE FROM luahrasa_sessions
          WHERE environment = ? AND telegram_user_id = ?`,
    args: [environment, key],
  });
  return true;
}
