import { isResetAdmin } from '../recovery.js';
import { sendMessage } from '../telegram.js';
import { currentSupportEnvironment, getSupportDb } from '../support/store.js';
import { getQuoteFilterGroup } from '../support/quote-filter.js';

const MALAYSIA_TIMEZONE = 'Asia/Kuala_Lumpur';
const TRACKED_AMOUNTS = [10, 20, 30, 50, 100];
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
  const back = (day + 6) % 7;
  return shiftDateKey(dateKey, -back);
}

function monthKeyFor(dateKey) {
  return String(dateKey || '').slice(0, 7);
}

function monthStartKey(monthKey) {
  return `${monthKey}-01`;
}

function monthEndKey(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0));
  return dateKeyFromUtcDate(last);
}

function formatDateKey(key, includeYear = true) {
  const date = utcDateFromKey(key);
  const text = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(date);
  return text.replace(',', '');
}

function formatRange(startKey, endKey) {
  const start = utcDateFromKey(startKey);
  const end = utcDateFromKey(endKey);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();

  if (sameMonth) {
    return `${start.getUTCDate()} ${new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(start)} - ${formatDateKey(endKey, true)}`;
  }
  if (sameYear) return `${formatDateKey(startKey, false)} - ${formatDateKey(endKey, true)}`;
  return `${formatDateKey(startKey, true)} - ${formatDateKey(endKey, true)}`;
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
  if (!TRACKED_AMOUNTS.includes(numericAmount)) return false;

  const callbackId = String(callbackQuery?.id || '').trim();
  const userId = Number(callbackQuery?.from?.id || 0);
  if (!callbackId || !Number.isSafeInteger(userId) || userId <= 0) return false;

  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const dateKey = malaysiaDateKey();
  const weekKey = mondayKeyFor(dateKey);
  const monthKey = monthKeyFor(dateKey);
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

function zeroStats() {
  return {
    total: 0,
    byAmount: Object.fromEntries(TRACKED_AMOUNTS.map((amount) => [amount, 0])),
  };
}

function rowToStats(row = {}) {
  return {
    total: Number(row.total_clicks || 0),
    byAmount: {
      10: Number(row.rm10 || 0),
      20: Number(row.rm20 || 0),
      30: Number(row.rm30 || 0),
      50: Number(row.rm50 || 0),
      100: Number(row.rm100 || 0),
    },
  };
}

async function statsFor(field, key) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const allowed = new Set(['date_key', 'week_key', 'month_key']);
  if (!allowed.has(field)) return zeroStats();

  const result = await db.execute({
    sql: `SELECT
            COUNT(*) AS total_clicks,
            SUM(CASE WHEN amount_cents = 1000 THEN 1 ELSE 0 END) AS rm10,
            SUM(CASE WHEN amount_cents = 2000 THEN 1 ELSE 0 END) AS rm20,
            SUM(CASE WHEN amount_cents = 3000 THEN 1 ELSE 0 END) AS rm30,
            SUM(CASE WHEN amount_cents = 5000 THEN 1 ELSE 0 END) AS rm50,
            SUM(CASE WHEN amount_cents = 10000 THEN 1 ELSE 0 END) AS rm100
          FROM support_amount_clicks
          WHERE environment = ? AND ${field} = ?`,
    args: [environment, String(key)],
  });
  return rowToStats(result.rows?.[0] || {});
}

async function monthlyHistory(currentMonthKey) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT
            month_key,
            COUNT(*) AS total_clicks,
            SUM(CASE WHEN amount_cents = 1000 THEN 1 ELSE 0 END) AS rm10,
            SUM(CASE WHEN amount_cents = 2000 THEN 1 ELSE 0 END) AS rm20,
            SUM(CASE WHEN amount_cents = 3000 THEN 1 ELSE 0 END) AS rm30,
            SUM(CASE WHEN amount_cents = 5000 THEN 1 ELSE 0 END) AS rm50,
            SUM(CASE WHEN amount_cents = 10000 THEN 1 ELSE 0 END) AS rm100
          FROM support_amount_clicks
          WHERE environment = ? AND month_key <> ?
          GROUP BY month_key
          ORDER BY month_key DESC`,
    args: [environment, String(currentMonthKey)],
  });
  return (result.rows || []).map((row) => ({
    monthKey: String(row.month_key || ''),
    ...rowToStats(row),
  }));
}

function statsLines(title, rangeText, stats) {
  return [
    `${title} — ${rangeText}`,
    `Total Semua Button: ${stats.total}`,
    `RM10 — ${stats.byAmount[10]}`,
    `RM20 — ${stats.byAmount[20]}`,
    `RM30 — ${stats.byAmount[30]}`,
    `RM50 — ${stats.byAmount[50]}`,
    `RM100 — ${stats.byAmount[100]}`,
  ];
}

async function groupIsConnected(chatId, context = {}) {
  const id = String(chatId || '');
  if (!id) return false;
  if (String(context?.mirrorGroupId || '') === id) return true;

  const quoteGroup = await getQuoteFilterGroup().catch(() => null);
  return String(quoteGroup?.groupId || '') === id;
}

async function sendChunked(chatId, lines) {
  let chunk = '';
  for (const line of lines) {
    const next = chunk ? `${chunk}\n${line}` : line;
    if (next.length > 3800) {
      await sendMessage(chatId, chunk);
      chunk = line;
    } else {
      chunk = next;
    }
  }
  if (chunk) await sendMessage(chatId, chunk);
}

export async function handleSupportPerClickCommand(message = {}, context = {}) {
  const chatId = message?.chat?.id;
  const chatType = String(message?.chat?.type || '');
  const userId = message?.from?.id;
  if (!chatId || !userId) return true;

  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ /supportperclick hanya untuk admin bot.').catch(() => {});
    return true;
  }

  if (!['private', 'group', 'supergroup'].includes(chatType)) {
    await sendMessage(chatId, '❌ /supportperclick hanya boleh digunakan dalam private chat admin atau group yang dah connect dengan bot.').catch(() => {});
    return true;
  }

  if (chatType !== 'private' && !(await groupIsConnected(chatId, context))) {
    await sendMessage(chatId, '❌ Group ini belum connect dengan bot. Guna command ini di private chat admin atau group yang dah connect.').catch(() => {});
    return true;
  }

  try {
    const todayKey = malaysiaDateKey();
    const weekKey = mondayKeyFor(todayKey);
    const weekEndKey = shiftDateKey(weekKey, 6);
    const monthKey = monthKeyFor(todayKey);
    const monthStart = monthStartKey(monthKey);
    const monthEnd = monthEndKey(monthKey);

    const [daily, weekly, monthly, history] = await Promise.all([
      statsFor('date_key', todayKey),
      statsFor('week_key', weekKey),
      statsFor('month_key', monthKey),
      monthlyHistory(monthKey),
    ]);

    const lines = [
      '📊 SUPPORT PER CLICK',
      '',
      ...statsLines('Daily', formatDateKey(todayKey, true), daily),
      '',
      ...statsLines('Per Week', formatRange(weekKey, weekEndKey), weekly),
      '',
      ...statsLines('Per Month', formatRange(monthStart, monthEnd), monthly),
      '',
      '🗂 History Bulanan',
    ];

    if (!history.length) {
      lines.push('Belum ada history bulan yang lengkap.');
    } else {
      for (const item of history) {
        const start = monthStartKey(item.monthKey);
        const end = monthEndKey(item.monthKey);
        lines.push(
          `${formatRange(start, end)} — Total ${item.total} | RM10 ${item.byAmount[10]} | RM20 ${item.byAmount[20]} | RM30 ${item.byAmount[30]} | RM50 ${item.byAmount[50]} | RM100 ${item.byAmount[100]}`,
        );
      }
    }

    lines.push('', 'Nota: kiraan ini berdasarkan setiap kali button amount ditekan. Data lama tidak dipadam; Daily/Week/Month bertukar automatik ikut tempoh Malaysia.');
    await sendChunked(chatId, lines);
  } catch (error) {
    console.error('[support-per-click] report failed:', error?.message);
    await sendMessage(chatId, '❌ Report Support Per Click tak dapat dibuka sekarang. Cuba lagi.').catch(() => {});
  }

  return true;
}
