import { currentSupportEnvironment, getSupportDb } from './store.js';

const MALAYSIA_TIMEZONE = 'Asia/Kuala_Lumpur';
const TRACKED_AMOUNTS = new Set([10, 20, 30, 50, 100]);
let schemaPromise = null;

function malaysiaDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MALAYSIA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function utcDateFromKey(key) {
  const [year, month, day] = String(key || '').split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKeyFromUtcDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function shiftDateKey(key, days) {
  const date = utcDateFromKey(key);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return dateKeyFromUtcDate(date);
}

function mondayKeyFor(dateKey) {
  const date = utcDateFromKey(dateKey);
  const day = date.getUTCDay();
  return shiftDateKey(dateKey, -((day + 6) % 7));
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS support_amount_clicks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          environment TEXT NOT NULL,
          callback_query_id TEXT NOT NULL,
          telegram_user_id TEXT NOT NULL,
          telegram_username TEXT NOT NULL DEFAULT '',
          amount_cents INTEGER NOT NULL,
          date_key TEXT NOT NULL,
          week_key TEXT NOT NULL,
          month_key TEXT NOT NULL,
          clicked_at TEXT NOT NULL,
          UNIQUE(environment, callback_query_id)
        )`,
        'CREATE INDEX IF NOT EXISTS idx_support_amount_clicks_date ON support_amount_clicks(environment, date_key)',
        'CREATE INDEX IF NOT EXISTS idx_support_amount_clicks_week ON support_amount_clicks(environment, week_key)',
        'CREATE INDEX IF NOT EXISTS idx_support_amount_clicks_month ON support_amount_clicks(environment, month_key)',
      ], 'write');
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function recordSupportAmountClick(callbackQuery = {}, amount) {
  const numericAmount = Number(amount || 0);
  if (!TRACKED_AMOUNTS.has(numericAmount)) return false;

  const callbackId = String(callbackQuery?.id || '').trim();
  const userId = Number(callbackQuery?.from?.id || 0);
  if (!callbackId || !Number.isSafeInteger(userId) || userId <= 0) return false;

  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const dateKey = malaysiaDateKey();
  const weekKey = mondayKeyFor(dateKey);
  const monthKey = dateKey.slice(0, 7);
  const username = String(callbackQuery?.from?.username || '').replace(/^@+/, '').slice(0, 64);

  await db.execute({
    sql: `INSERT OR IGNORE INTO support_amount_clicks (
            environment, callback_query_id, telegram_user_id, telegram_username,
            amount_cents, date_key, week_key, month_key, clicked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      environment,
      callbackId,
      String(userId),
      username,
      Math.round(numericAmount * 100),
      dateKey,
      weekKey,
      monthKey,
      new Date().toISOString(),
    ],
  });
  return true;
}
