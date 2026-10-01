import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import { supportCampaignText, supportMenuKeyboard } from '../features/support.js';
import { getActiveSupporterTitle } from './community-store.js';
import { currentSupportEnvironment, getSupportDb } from './store.js';

export const FRIDAY_SUPPORT_MODE_NORMAL = 'NORMAL';
export const FRIDAY_SUPPORT_MODE_FORCE = 'FORCE';
export const FRIDAY_SUPPORT_MODE_DONATE = 'DONATE';

const MALAYSIA_TIMEZONE = 'Asia/Kuala_Lumpur';
const SHARE_CALLBACK_PREFIX = 'friday:share:';
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
        `CREATE TABLE IF NOT EXISTS support_friday_share_clicks (
          environment TEXT NOT NULL,
          telegram_user_id TEXT NOT NULL,
          date_key TEXT NOT NULL,
          slot INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (environment, telegram_user_id, date_key, slot)
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

async function shareSlots(userId, dateKey) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT slot FROM support_friday_share_clicks
          WHERE environment = ? AND telegram_user_id = ? AND date_key = ?
          ORDER BY slot ASC`,
    args: [environment, String(userId), String(dateKey)],
  });
  return new Set((result.rows || []).map((row) => Number(row.slot)).filter((slot) => slot >= 1 && slot <= 3));
}

async function markShareSlot(userId, dateKey, slot) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT OR IGNORE INTO support_friday_share_clicks (
            environment, telegram_user_id, date_key, slot, created_at
          ) VALUES (?, ?, ?, ?, ?)`,
    args: [environment, String(userId), String(dateKey), Number(slot), now],
  });
  return shareSlots(userId, dateKey);
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

async function botShareLink() {
  const username = await botUsername();
  return username ? `https://t.me/${username}` : 'https://t.me/ar_downloaderbot';
}

function isUsageAttempt(message = {}) {
  if (Array.isArray(message?.photo) && message.photo.length) return true;
  if (message?.video?.file_id) return true;
  const text = String(message?.text || message?.caption || '').trim();
  if (/^\/status(?:@\w+)?(?:\s|$)/i.test(text)) return true;
  return /https?:\/\/\S+/i.test(text);
}

async function sendForceLock(chatId) {
  await sendMessage(
    chatId,
    ['Please Support kita dulu utk guna bot ❤️', '', supportCampaignText()].join('\n'),
    { reply_markup: supportMenuKeyboard() },
  );
}

function donateKeyboard(slots = new Set()) {
  return {
    inline_keyboard: [1, 2, 3].map((slot) => [{
      text: slots.has(slot) ? `✅ Share #${slot} dikira` : `📤 Share #${slot}`,
      callback_data: `${SHARE_CALLBACK_PREFIX}${slot}`,
    }]),
  };
}

async function donateText(userId, dateKey) {
  const slots = await shareSlots(userId, dateKey);
  const link = await botShareLink();
  return {
    slots,
    text: [
      supportCampaignText(),
      '',
      '🤝 Kalau belum Supporter, share bot ni ke 3 group lain atau mana-mana platform sosial media dulu untuk guna bot hari Jumaat ni.',
      '',
      `Link bot: ${link}`,
      '',
      `Progress share: ${slots.size}/3`,
      'Lepas setiap kali share, tekan button Share #1, kemudian #2, kemudian #3.',
      'Kita guna sistem percaya — bot tak verify tempat korang share ❤️',
    ].join('\n'),
  };
}

async function sendDonateGate(chatId, userId, dateKey) {
  const view = await donateText(userId, dateKey);
  await sendMessage(chatId, view.text, { reply_markup: donateKeyboard(view.slots) });
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

  if (mode === FRIDAY_SUPPORT_MODE_FORCE) {
    return { gated: true, mode, parts, supporter: null };
  }

  const slots = await shareSlots(userId, parts.dateKey);
  return {
    gated: slots.size < 3,
    mode,
    parts,
    supporter: null,
    slots,
  };
}

export async function enforceFridaySupportForMessage(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId || message?.chat?.type !== 'private') return false;
  if (isResetAdmin(userId) || !isUsageAttempt(message)) return false;

  const context = await accessContext(userId);
  if (!context.gated) return false;

  if (context.mode === FRIDAY_SUPPORT_MODE_FORCE) await sendForceLock(chatId);
  else if (context.mode === FRIDAY_SUPPORT_MODE_DONATE) await sendDonateGate(chatId, userId, context.parts.dateKey);
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
      ? 'Please Support kita dulu utk guna bot ❤️'
      : `Share dulu ya ❤️ Progress ${context.slots?.size || 0}/3`,
    show_alert: true,
  }).catch(() => {});

  if (context.mode === FRIDAY_SUPPORT_MODE_FORCE) await sendForceLock(chatId).catch(() => {});
  else if (context.mode === FRIDAY_SUPPORT_MODE_DONATE) {
    await sendDonateGate(chatId, userId, context.parts.dateKey).catch(() => {});
  }
  return true;
}

async function updateDonateMessage(callbackQuery, userId, dateKey, slots) {
  const chatId = callbackQuery?.message?.chat?.id;
  const messageId = callbackQuery?.message?.message_id;
  if (!chatId || !messageId) return;
  const link = await botShareLink();
  const text = [
    supportCampaignText(),
    '',
    '🤝 Kalau belum Supporter, share bot ni ke 3 group lain atau mana-mana platform sosial media dulu untuk guna bot hari Jumaat ni.',
    '',
    `Link bot: ${link}`,
    '',
    `Progress share: ${slots.size}/3`,
    slots.size >= 3
      ? '✅ Selesai 3/3. Bot dah unlock untuk Jumaat ni.'
      : 'Lepas setiap kali share, tekan button Share #1, kemudian #2, kemudian #3.',
    'Kita guna sistem percaya — bot tak verify tempat korang share ❤️',
  ].join('\n');

  await telegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    reply_markup: slots.size >= 3 ? { inline_keyboard: [] } : donateKeyboard(slots),
  }).catch((error) => {
    if (!String(error?.message || '').includes('message is not modified')) throw error;
  });
}

export async function processFridaySupportCallback(callbackQuery = {}) {
  const action = String(callbackQuery?.data || '');
  const match = action.match(/^friday:share:([123])$/);
  if (!match) return false;

  const slot = Number(match[1]);
  const chatId = callbackQuery?.message?.chat?.id;
  const userId = callbackQuery?.from?.id;
  if (!chatId || !userId || callbackQuery?.message?.chat?.type !== 'private') return true;

  const parts = malaysiaParts();
  const mode = await getFridaySupportMode();
  if (parts.weekday !== 'Fri' || mode !== FRIDAY_SUPPORT_MODE_DONATE) {
    await telegram('answerCallbackQuery', {
      callback_query_id: callbackQuery?.id,
      text: 'Donate/Share mode tak aktif sekarang.',
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

  const before = await shareSlots(userId, parts.dateKey);
  for (let required = 1; required < slot; required += 1) {
    if (!before.has(required)) {
      await telegram('answerCallbackQuery', {
        callback_query_id: callbackQuery?.id,
        text: `Tekan Share #${required} dulu ya ❤️`,
        show_alert: true,
      }).catch(() => {});
      return true;
    }
  }

  const slots = before.has(slot) ? before : await markShareSlot(userId, parts.dateKey, slot);
  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery?.id,
    text: slots.size >= 3
      ? 'Terima kasih ❤️ 3/3 selesai. Bot dah unlock untuk Jumaat ni.'
      : `Share #${slot} dikira ✅ Progress ${slots.size}/3`,
    show_alert: false,
  }).catch(() => {});
  await updateDonateMessage(callbackQuery, userId, parts.dateKey, slots).catch((error) => {
    console.warn('[friday-support] share message update failed:', error?.message);
  });
  return true;
}

function modeHeader(mode) {
  if (mode === FRIDAY_SUPPORT_MODE_FORCE) return '🔒 /forcesupport aktif.';
  if (mode === FRIDAY_SUPPORT_MODE_DONATE) return '🤝 /donatesupport aktif.';
  return '✅ /normalsupport aktif.';
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
  await sendMessage(
    chatId,
    [modeHeader(saved), '', supportCampaignText()].join('\n'),
    { reply_markup: supportMenuKeyboard() },
  );
  return true;
}