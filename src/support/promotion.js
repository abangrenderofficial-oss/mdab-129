import { readFile } from 'node:fs/promises';
import { currentSupportEnvironment, getSupportDb } from './store.js';
import { sendMessage, sendSupportPromotionToChannel, telegram } from '../telegram.js';

const STATS_FILE = String(process.env.STATS_FILE_PATH || '/data/bot-stats.json');
const MALAYSIA_TIMEZONE = 'Asia/Kuala_Lumpur';
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_PROMO_HOUR = 10;
const PRIVATE_SEND_DELAY_MS = 55;

let schedulerTimer = null;
let cycleRunning = false;
let schemaPromise = null;
let cachedBotUsername = '';

function channelUsername() {
  const configured = String(process.env.REQUIRED_CHANNEL_USERNAME || '@ar_downloaderbot').trim();
  if (!configured) return '@ar_downloaderbot';
  if (configured.startsWith('@')) return configured;
  if (/^https?:\/\/t\.me\//i.test(configured)) {
    const slug = configured.replace(/^https?:\/\/t\.me\//i, '').split(/[/?#]/)[0];
    return slug ? `@${slug}` : '@ar_downloaderbot';
  }
  return `@${configured.replace(/^@/, '')}`;
}

function promoHour() {
  const value = Number(process.env.SUPPORT_PROMO_HOUR_MY ?? DEFAULT_PROMO_HOUR);
  if (!Number.isInteger(value) || value < 0 || value > 23) return DEFAULT_PROMO_HOUR;
  return value;
}

function malaysiaParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MALAYSIA_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour || 0),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    monthKey: `${parts.year}-${parts.month}`,
  };
}

function malaysiaMonthKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return malaysiaParts(date).monthKey;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensurePromotionSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.execute(`CREATE TABLE IF NOT EXISTS support_promotion_delivery (
        environment TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        period_key TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT,
        PRIMARY KEY (environment, target_type, target_id, period_key)
      )`);
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function alreadySent(targetType, targetId, periodKey) {
  await ensurePromotionSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT status FROM support_promotion_delivery
          WHERE environment = ? AND target_type = ? AND target_id = ? AND period_key = ?
          LIMIT 1`,
    args: [environment, targetType, String(targetId), periodKey],
  });
  return String(result.rows?.[0]?.status || '') === 'SENT';
}

async function markDelivery(targetType, targetId, periodKey, status, errorMessage = '') {
  await ensurePromotionSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO support_promotion_delivery (
            environment, target_type, target_id, period_key, status,
            error_message, created_at, updated_at, sent_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(environment, target_type, target_id, period_key) DO UPDATE SET
            status = excluded.status,
            error_message = excluded.error_message,
            updated_at = excluded.updated_at,
            sent_at = CASE WHEN excluded.status = 'SENT' THEN excluded.sent_at ELSE support_promotion_delivery.sent_at END`,
    args: [
      environment,
      targetType,
      String(targetId),
      periodKey,
      status,
      String(errorMessage || '').slice(0, 300),
      now,
      now,
      status === 'SENT' ? now : null,
    ],
  });
}

async function trackedUserIds() {
  try {
    const raw = await readFile(STATS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Object.keys(data?.users || {}).filter((id) => /^\d+$/.test(id));
  } catch (error) {
    console.warn('[support-promo] user registry read failed:', error?.message);
    return [];
  }
}

async function paidSupporterHistory() {
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT telegram_user_id, MAX(paid_at) AS last_paid_at
          FROM support_orders
          WHERE environment = ? AND status = 'PAID' AND paid_at IS NOT NULL
          GROUP BY telegram_user_id`,
    args: [environment],
  });
  const map = new Map();
  for (const row of result.rows || []) {
    const userId = String(row.telegram_user_id || '');
    if (userId) map.set(userId, String(row.last_paid_at || ''));
  }
  return map;
}

async function botUsername() {
  if (cachedBotUsername) return cachedBotUsername;
  const me = await telegram('getMe');
  cachedBotUsername = String(me?.username || '').replace(/^@/, '');
  return cachedBotUsername;
}

function promotionText({ supporter = false } = {}) {
  return [
    supporter ? '❤️ Terima kasih sebab pernah support bot kita!' : '❤️ jom sama2 bantu kembangkan bot ni nak?',
    '',
    'Bot ni boleh mati bila2 masa if kita sama2 tak berjaya bayarkan kos sewa server.',
    'Support korang bantu cover sewa server dan perkembangan bot supaya bot ni boleh stay dan terus korang guna.',
    '',
    'Sekali seumur hidup pun tak pe. Terima kasih orang baik ! 🙇🏻❤️',
  ].join('\n');
}

async function sendPrivatePromotion(userId, supporter) {
  await sendMessage(userId, promotionText({ supporter }), {
    reply_markup: {
      inline_keyboard: [[{ text: '❤️ Support Bot', callback_data: 'support:amounts' }]],
    },
  });
}

async function sendChannelPromotion() {
  const username = await botUsername();
  const url = username ? `https://t.me/${username}?start=support` : '';
  await sendSupportPromotionToChannel(channelUsername(), promotionText({ supporter: false }), {
    ...(url ? {
      reply_markup: {
        inline_keyboard: [[{ text: '❤️ Support Bot', url }]],
      },
    } : {}),
  });
}

async function deliverChannelFriday(dateKey) {
  const target = channelUsername();
  const periodKey = `friday:${dateKey}`;
  if (await alreadySent('CHANNEL', target, periodKey)) return false;
  try {
    await sendChannelPromotion();
    await markDelivery('CHANNEL', target, periodKey, 'SENT');
    console.log('[support-promo] channel sent', { target, periodKey });
    return true;
  } catch (error) {
    await markDelivery('CHANNEL', target, periodKey, 'FAILED', error?.message).catch(() => {});
    console.warn('[support-promo] channel send failed:', error?.message);
    return false;
  }
}

async function deliverPrivateFriday({ dateKey, monthKey }) {
  const [users, paidMap] = await Promise.all([trackedUserIds(), paidSupporterHistory()]);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const userId of users) {
    const lastPaidAt = paidMap.get(userId) || '';
    const supporter = Boolean(lastPaidAt);

    let periodKey;
    if (supporter) {
      const paidMonth = malaysiaMonthKey(lastPaidAt);
      if (!paidMonth || monthKey <= paidMonth) {
        skipped += 1;
        continue;
      }
      periodKey = `supporter:${monthKey}`;
    } else {
      periodKey = `nonsupporter:${dateKey}`;
    }

    if (await alreadySent('PRIVATE', userId, periodKey)) {
      skipped += 1;
      continue;
    }

    try {
      await sendPrivatePromotion(userId, supporter);
      await markDelivery('PRIVATE', userId, periodKey, 'SENT');
      sent += 1;
    } catch (error) {
      await markDelivery('PRIVATE', userId, periodKey, 'FAILED', error?.message).catch(() => {});
      failed += 1;
    }

    await sleep(PRIVATE_SEND_DELAY_MS);
  }

  console.log('[support-promo] private cycle complete', { users: users.length, sent, skipped, failed });
  return { users: users.length, sent, skipped, failed };
}

export async function runSupportPromotionCycle({ force = false } = {}) {
  if (cycleRunning) return { skipped: true, reason: 'already_running' };
  cycleRunning = true;
  try {
    const parts = malaysiaParts();
    if (!force && parts.weekday !== 'Fri') return { skipped: true, reason: 'not_friday', parts };
    if (!force && parts.hour < promoHour()) return { skipped: true, reason: 'too_early', parts };

    const channelSent = await deliverChannelFriday(parts.dateKey);
    const privateResult = await deliverPrivateFriday(parts);
    return { skipped: false, channelSent, privateResult, parts };
  } finally {
    cycleRunning = false;
  }
}

export function startSupportPromotionScheduler() {
  if (schedulerTimer) return schedulerTimer;

  const run = () => {
    void runSupportPromotionCycle().catch((error) => {
      console.error('[support-promo] scheduler cycle failed:', error?.message);
    });
  };

  setTimeout(run, 20_000);
  schedulerTimer = setInterval(run, CHECK_INTERVAL_MS);
  schedulerTimer.unref?.();
  console.log('[support-promo] scheduler started', {
    timezone: MALAYSIA_TIMEZONE,
    fridayHour: promoHour(),
    channel: channelUsername(),
  });
  return schedulerTimer;
}
