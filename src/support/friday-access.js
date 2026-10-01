import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import { getActiveSupporterTitle } from './community-store.js';
import { currentSupportEnvironment, getSupportDb } from './store.js';

export const FRIDAY_SUPPORT_MODE_NORMAL = 'NORMAL';
export const FRIDAY_SUPPORT_MODE_FORCE = 'FORCE';
export const FRIDAY_SUPPORT_MODE_DONATE = 'DONATE';

const MALAYSIA_TIMEZONE = 'Asia/Kuala_Lumpur';
const DONATE_CONFIRM_CALLBACK = 'friday:shared3';
let schemaPromise = null;
let cachedBotUsername = '';

function validMode(value) {
  const mode = String(value || '').trim().toUpperCase();
  return [FRIDAY_SUPPORT_MODE_NORMAL, FRIDAY_SUPPORT_MODE_FORCE, FRIDAY_SUPPORT_MODE_DONATE].includes(mode)
    ? mode
    : FRIDAY_SUPPORT_MODE_NORMAL;
}

function malaysiaParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MALAYSIA_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: String(parts.weekday || ''),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS support_friday_mode (
          environment TEXT NOT NULL PRIMARY KEY,
          mode TEXT NOT NULL DEFAULT 'NORMAL',
          updated_by TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS support_friday_access (
          environment TEXT NOT NULL,
          telegram_user_id TEXT NOT NULL,
          date_key TEXT NOT NULL,
          force_success_count INTEGER NOT NULL DEFAULT 0,
          donate_unlocked INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, telegram_user_id, date_key)
        )`,
      ], 'write');
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function getFridaySupportMode() {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT mode FROM support_friday_mode WHERE environment = ? LIMIT 1`,
    args: [environment],
  });
  return validMode(result.rows?.[0]?.mode || FRIDAY_SUPPORT_MODE_NORMAL);
}

export async function setFridaySupportMode(mode, adminUserId = '') {
  const normalized = validMode(mode);
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO support_friday_mode (environment, mode, updated_by, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(environment) DO UPDATE SET
            mode = excluded.mode,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
    args: [environment, normalized, String(adminUserId || ''), now],
  });
  return normalized;
}

async function getUserFridayState(userId, dateKey) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT force_success_count, donate_unlocked
          FROM support_friday_access
          WHERE environment = ? AND telegram_user_id = ? AND date_key = ?
          LIMIT 1`,
    args: [environment, String(userId), String(dateKey)],
  });
  return {
    forceSuccessCount: Number(result.rows?.[0]?.force_success_count || 0),
    donateUnlocked: Number(result.rows?.[0]?.donate_unlocked || 0) === 1,
  };
}

async function setDonateUnlocked(userId, dateKey) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO support_friday_access (
            environment, telegram_user_id, date_key, force_success_count, donate_unlocked, updated_at
          ) VALUES (?, ?, ?, 0, 1, ?)
          ON CONFLICT(environment, telegram_user_id, date_key) DO UPDATE SET
            donate_unlocked = 1,
            updated_at = excluded.updated_at`,
    args: [environment, String(userId), String(dateKey), now],
  });
}

async function botUsername() {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await telegram('getMe');
    cachedBotUsername = String(me?.username || '').replace(/^@/, '');
  } catch {
    cachedBotUsername = '';
  }
  return cachedBotUsername;
}

async function shareUrl() {
  const username = await botUsername();
  const botUrl = username ? `https://t.me/${username}` : 'https://t.me/ar_downloaderbot';
  const text = 'Bot ni boleh download TikTok, Instagram, Threads, X/Twitter & YouTube. Cuba sini 👇';
  return `https://t.me/share/url?url=${encodeURIComponent(botUrl)}&text=${encodeURIComponent(text)}`;
}

async function sendForceLock(chatId) {
  await sendMessage(
    chatId,
    [
      '❤️ Support Bot Untuk Terus Guna',
      '',
      'Free use Jumaat untuk hari ni dah digunakan.',
      'Untuk penggunaan seterusnya, bot dibuka untuk Supporter sahaja.',
      '',
      'Minimum support RM10 dan status Supporter aktif selama 1 bulan.',
      'Lepas payment confirmed, bot terus unlock automatik ✨',
    ].join('\n'),
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🤍 Support RM10 & Unlock', callback_data: 'support:select:10' }],
          [{ text: '💎 Pilih Tier Lain', callback_data: 'support:amounts' }],
        ],
      },
    },
  );
}

async function sendDonateGate(chatId) {
  const url = await shareUrl();
  await sendMessage(
    chatId,
    [
      '🤝 Friday Share Support',
      '',
      'Hari Jumaat ni tak perlu bayar untuk terus guna bot.',
      'Kalau belum jadi Supporter, tolong share bot ni ke 3 group yang lain ya ❤️',
      '',
      'Lepas share, tekan button “✅ Dah Share 3 Group”.',
      'Terima kasih sebab bantu bot ni sampai dekat lebih ramai orang ✨',
    ].join('\n'),
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📤 Share Bot ke Group', url }],
          [{ text: '✅ Dah Share 3 Group', callback_data: DONATE_CONFIRM_CALLBACK }],
          [{ text: '❤️ Jadi Supporter', callback_data: 'support:amounts' }],
        ],
      },
    },
  );
}

async function accessContext(userId) {
  const parts = malaysiaParts();
  if (parts.weekday !== 'Fri') {
    return { gated: false, mode: FRIDAY_SUPPORT_MODE_NORMAL, parts, supporter: null };
  }

  const mode = await getFridaySupportMode();
  if (mode === FRIDAY_SUPPORT_MODE_NORMAL) {
    return { gated: false, mode, parts, supporter: null };
  }

  const supporter = await getActiveSupporterTitle(userId);
  if (supporter) {
    return { gated: false, mode, parts, supporter };
  }

  const state = await getUserFridayState(userId, parts.dateKey);
  if (mode === FRIDAY_SUPPORT_MODE_FORCE) {
    return {
      gated: state.forceSuccessCount >= 1,
      mode,
      parts,
      supporter: null,
      state,
    };
  }

  return {
    gated: !state.donateUnlocked,
    mode,
    parts,
    supporter: null,
    state,
  };
}

export async function enforceFridaySupportForMessage(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId || message?.chat?.type !== 'private') return false;
  if (isResetAdmin(userId)) return false;

  const context = await accessContext(userId);
  if (!context.gated) return false;

  if (context.mode === FRIDAY_SUPPORT_MODE_FORCE) await sendForceLock(chatId);
  else if (context.mode === FRIDAY_SUPPORT_MODE_DONATE) await sendDonateGate(chatId);
  return true;
}

export async function enforceFridaySupportForCallback(callbackQuery = {}) {
  const chatId = callbackQuery?.message?.chat?.id;
  const chatType = callbackQuery?.message?.chat?.type;
  const userId = callbackQuery?.from?.id;
  if (!chatId || !userId || chatType !== 'private') return false;
  if (isResetAdmin(userId)) return false;

  const context = await accessContext(userId);
  if (!context.gated) return false;

  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery?.id,
    text: context.mode === FRIDAY_SUPPORT_MODE_FORCE
      ? 'Free use Jumaat dah digunakan. Support RM10+ untuk terus guna ❤️'
      : 'Share ke 3 group dulu, kemudian tekan “Dah Share 3 Group” ya ❤️',
    show_alert: true,
  }).catch(() => {});

  if (context.mode === FRIDAY_SUPPORT_MODE_FORCE) await sendForceLock(chatId).catch(() => {});
  else if (context.mode === FRIDAY_SUPPORT_MODE_DONATE) await sendDonateGate(chatId).catch(() => {});
  return true;
}

export async function markFridayUsageSuccess(userId) {
  const id = Number(userId || 0);
  if (!Number.isSafeInteger(id) || id <= 0 || isResetAdmin(id)) return false;

  const parts = malaysiaParts();
  if (parts.weekday !== 'Fri') return false;
  const mode = await getFridaySupportMode();
  if (mode !== FRIDAY_SUPPORT_MODE_FORCE) return false;
  if (await getActiveSupporterTitle(id)) return false;

  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO support_friday_access (
            environment, telegram_user_id, date_key, force_success_count, donate_unlocked, updated_at
          ) VALUES (?, ?, ?, 1, 0, ?)
          ON CONFLICT(environment, telegram_user_id, date_key) DO UPDATE SET
            force_success_count = CASE
              WHEN support_friday_access.force_success_count < 1 THEN 1
              ELSE support_friday_access.force_success_count
            END,
            updated_at = excluded.updated_at`,
    args: [environment, String(id), parts.dateKey, now],
  });
  return true;
}

export async function processFridaySupportCallback(callbackQuery = {}) {
  const action = String(callbackQuery?.data || '');
  if (action !== DONATE_CONFIRM_CALLBACK) return false;

  const chatId = callbackQuery?.message?.chat?.id;
  const userId = callbackQuery?.from?.id;
  if (!chatId || !userId || callbackQuery?.message?.chat?.type !== 'private') return true;

  const parts = malaysiaParts();
  const mode = await getFridaySupportMode();
  if (parts.weekday !== 'Fri' || mode !== FRIDAY_SUPPORT_MODE_DONATE) {
    await telegram('answerCallbackQuery', {
      callback_query_id: callbackQuery?.id,
      text: 'Friday Share Mode tak aktif sekarang.',
      show_alert: true,
    }).catch(() => {});
    return true;
  }

  if (await getActiveSupporterTitle(userId)) {
    await telegram('answerCallbackQuery', {
      callback_query_id: callbackQuery?.id,
      text: 'Awak dah Supporter aktif ❤️ Tak perlu share.',
      show_alert: false,
    }).catch(() => {});
    return true;
  }

  await setDonateUnlocked(userId, parts.dateKey);
  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery?.id,
    text: 'Terima kasih support share bot ni ❤️',
    show_alert: false,
  }).catch(() => {});
  await sendMessage(
    chatId,
    '✅ Dah unlock untuk Jumaat ni. Terima kasih sebab bantu share bot ni ❤️\n\nBoleh terus guna macam biasa.',
  ).catch(() => {});
  return true;
}

function modeReply(mode) {
  if (mode === FRIDAY_SUPPORT_MODE_FORCE) {
    return [
      '🔒 Friday Support Mode: FORCE',
      '',
      'Setiap Jumaat:',
      '• Supporter aktif → terus guna bot',
      '• Non-supporter → 1 successful use free',
      '• Lepas tu lock → minimum support RM10 untuk unlock',
      '',
      'Mode ni kekal sehingga admin tukar ke /donatesupport atau /supportnormal.',
    ].join('\n');
  }
  if (mode === FRIDAY_SUPPORT_MODE_DONATE) {
    return [
      '🤝 Friday Support Mode: DONATE / SHARE',
      '',
      'Setiap Jumaat:',
      '• Supporter aktif → terus guna bot',
      '• Non-supporter → diminta share bot ke 3 group',
      '• Verification longgar: user tekan “Dah Share 3 Group” untuk unlock Jumaat itu',
      '',
      'Mode ni kekal sehingga admin tukar ke /forcesupport atau /supportnormal.',
    ].join('\n');
  }
  return [
    '✅ Friday Support Mode: NORMAL',
    '',
    'Tiada payment lock dan tiada share gate pada hari Jumaat.',
    'Promo support biasa masih boleh berjalan seperti scheduler sedia ada.',
  ].join('\n');
}

export async function handleFridaySupportModeCommand(message = {}, mode) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return true;

  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ Command support mode hanya untuk admin bot.').catch(() => {});
    return true;
  }
  if (message?.chat?.type !== 'private') {
    await sendMessage(chatId, '❌ Command support mode hanya boleh digunakan dalam private chat bot.').catch(() => {});
    return true;
  }

  const saved = await setFridaySupportMode(mode, userId);
  await sendMessage(chatId, modeReply(saved));
  return true;
}
