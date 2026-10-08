import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import { supportCampaignText, supportMenuKeyboard } from '../features/support.js';
import { getActiveSupporterTitle } from './community-store.js';
import {isPayPingSharedConfigEnabled} from './payping-shared-config.js';
import { currentSupportEnvironment, getSupportDb } from './store.js';

export const FRIDAY_SUPPORT_MODE_OFF = 'OFF';
export const FRIDAY_SUPPORT_MODE_NORMAL = 'NORMAL';
export const FRIDAY_SUPPORT_MODE_FORCE = 'FORCE';
export const FRIDAY_SUPPORT_MODE_DONATE = 'DONATE';

const MALAYSIA_TIMEZONE = 'Asia/Kuala_Lumpur';
const SHARE_CALLBACK_PREFIX = 'friday:share:';
let schemaPromise = null;
let cachedBotUsername = '';

function validMode(value) {
  const mode = String(value || '').trim().toUpperCase();
  return [
    FRIDAY_SUPPORT_MODE_OFF,
    FRIDAY_SUPPORT_MODE_NORMAL,
    FRIDAY_SUPPORT_MODE_FORCE,
    FRIDAY_SUPPORT_MODE_DONATE,
  ].includes(mode)
    ? mode
    : FRIDAY_SUPPORT_MODE_OFF;
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
          mode TEXT NOT NULL DEFAULT 'OFF',
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
        `CREATE TABLE IF NOT EXISTS support_friday_usage_state (
          environment TEXT NOT NULL,
          telegram_user_id TEXT NOT NULL,
          date_key TEXT NOT NULL,
          used_once INTEGER NOT NULL DEFAULT 0,
          post_use_prompt_sent INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, telegram_user_id, date_key)
        )`,
      ], 'write');

      const usageColumns = await db.execute('PRAGMA table_info(support_friday_usage_state)');
      const hasUseClaimed = (usageColumns.rows || []).some((row) => String(row.name || '') === 'use_claimed');
      if (!hasUseClaimed) {
        await db.execute(
          'ALTER TABLE support_friday_usage_state ADD COLUMN use_claimed INTEGER NOT NULL DEFAULT 0',
        );
      }
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
  return validMode(result.rows?.[0]?.mode || FRIDAY_SUPPORT_MODE_OFF);
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

async function usageState(userId, dateKey) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT used_once, post_use_prompt_sent, use_claimed
          FROM support_friday_usage_state
          WHERE environment = ? AND telegram_user_id = ? AND date_key = ?
          LIMIT 1`,
    args: [environment, String(userId), String(dateKey)],
  });
  return {
    usedOnce: Number(result.rows?.[0]?.used_once || 0) === 1,
    promptSent: Number(result.rows?.[0]?.post_use_prompt_sent || 0) === 1,
    useClaimed: Number(result.rows?.[0]?.use_claimed || 0) === 1,
  };
}

async function markFirstUseAndClaimPrompt(userId, dateKey) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO support_friday_usage_state (
            environment, telegram_user_id, date_key, used_once, post_use_prompt_sent, updated_at
          ) VALUES (?, ?, ?, 1, 0, ?)
          ON CONFLICT(environment, telegram_user_id, date_key) DO UPDATE SET
            used_once = 1,
            use_claimed = 0,
            updated_at = excluded.updated_at`,
    args: [environment, String(userId), String(dateKey), now],
  });

  const claimed = await db.execute({
    sql: `UPDATE support_friday_usage_state
          SET post_use_prompt_sent = 1, updated_at = ?
          WHERE environment = ? AND telegram_user_id = ? AND date_key = ?
            AND post_use_prompt_sent = 0`,
    args: [now, environment, String(userId), String(dateKey)],
  });
  return Number(claimed.rowsAffected || 0) > 0;
}

export async function claimFridayUsageAttempt(userId) {
  if(isPayPingSharedConfigEnabled())return false;
  const id = Number(userId || 0);
  if (!Number.isSafeInteger(id) || id <= 0 || isResetAdmin(id)) return false;

  const parts = malaysiaParts();
  if (parts.weekday !== 'Fri') return false;

  const mode = await getFridaySupportMode();
  if (![FRIDAY_SUPPORT_MODE_FORCE, FRIDAY_SUPPORT_MODE_DONATE].includes(mode)) return false;
  if (await getActiveSupporterTitle(id)) return false;

  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT OR IGNORE INTO support_friday_usage_state (
            environment, telegram_user_id, date_key, used_once, post_use_prompt_sent, use_claimed, updated_at
          ) VALUES (?, ?, ?, 0, 0, 0, ?)`,
    args: [environment, String(id), parts.dateKey, now],
  });

  const claimed = await db.execute({
    sql: `UPDATE support_friday_usage_state
          SET use_claimed = 1, updated_at = ?
          WHERE environment = ? AND telegram_user_id = ? AND date_key = ?
            AND used_once = 0 AND use_claimed = 0`,
    args: [now, environment, String(id), parts.dateKey],
  });
  return Number(claimed.rowsAffected || 0) > 0;
}

export async function releaseFridayUsageAttempt(userId) {
  const id = Number(userId || 0);
  if (!Number.isSafeInteger(id) || id <= 0) return false;

  const parts = malaysiaParts();
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `UPDATE support_friday_usage_state
          SET use_claimed = 0, updated_at = ?
          WHERE environment = ? AND telegram_user_id = ? AND date_key = ?
            AND used_once = 0 AND use_claimed = 1`,
    args: [new Date().toISOString(), environment, String(id), parts.dateKey],
  });
  return Number(result.rowsAffected || 0) > 0;
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

async function sendPostUseSupportPrompt(chatId) {
  await sendMessage(chatId, supportCampaignText(), {
    reply_markup: supportMenuKeyboard(),
  });
}

async function sendForceLock(chatId) {
  await sendMessage(
    chatId,
    'Please Support Kita dulu utk guna Bot ❤️',
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
      'Please Share bot ni ke 3 group sosial media dulu',
      '',
      `Link bot: ${link}`,
      `Progress share: ${slots.size}/3`,
      '',
      'Tekan Share #1, kemudian Share #2, kemudian Share #3 selepas korang share.',
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
  if(isPayPingSharedConfigEnabled())return {gated:false,mode:FRIDAY_SUPPORT_MODE_OFF,parts,supporter:null};
  if (parts.weekday !== 'Fri') {
    return { gated: false, mode: FRIDAY_SUPPORT_MODE_OFF, parts, supporter: null };
  }

  const mode = await getFridaySupportMode();
  if (mode === FRIDAY_SUPPORT_MODE_OFF) {
    return { gated: false, mode, parts, supporter: null };
  }

  const supporter = await getActiveSupporterTitle(userId);
  if (supporter) {
    return { gated: false, mode, parts, supporter };
  }

  const state = await usageState(userId, parts.dateKey);
  if (mode === FRIDAY_SUPPORT_MODE_NORMAL) {
    return { gated: false, mode, parts, supporter: null, state };
  }

  if (!state.usedOnce && !state.useClaimed) {
    return { gated: false, mode, parts, supporter: null, state };
  }

  if (mode === FRIDAY_SUPPORT_MODE_FORCE) {
    return { gated: true, mode, parts, supporter: null, state };
  }

  const slots = await shareSlots(userId, parts.dateKey);
  return {
    gated: slots.size < 3,
    mode,
    parts,
    supporter: null,
    state,
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
      ? 'Please Support Kita dulu utk guna Bot ❤️'
      : `Please Share bot ni ke 3 group sosial media dulu (${context.slots?.size || 0}/3)`,
    show_alert: true,
  }).catch(() => {});

  if (context.mode === FRIDAY_SUPPORT_MODE_FORCE) await sendForceLock(chatId).catch(() => {});
  else if (context.mode === FRIDAY_SUPPORT_MODE_DONATE) {
    await sendDonateGate(chatId, userId, context.parts.dateKey).catch(() => {});
  }
  return true;
}

export async function markFridayUsageSuccess(userId) {
  if(isPayPingSharedConfigEnabled())return false;
  const id = Number(userId || 0);
  if (!Number.isSafeInteger(id) || id <= 0 || isResetAdmin(id)) return false;

  const parts = malaysiaParts();
  if (parts.weekday !== 'Fri') return false;

  const mode = await getFridaySupportMode();
  if (mode === FRIDAY_SUPPORT_MODE_OFF) return false;

  if (await getActiveSupporterTitle(id)) return false;

  const shouldPrompt = await markFirstUseAndClaimPrompt(id, parts.dateKey);
  if (!shouldPrompt) return false;

  await sendPostUseSupportPrompt(id).catch((error) => {
    console.warn('[friday-support] post-use support prompt failed:', error?.message);
  });
  return true;
}

async function updateDonateMessage(callbackQuery, userId, dateKey, slots) {
  const chatId = callbackQuery?.message?.chat?.id;
  const messageId = callbackQuery?.message?.message_id;
  if (!chatId || !messageId) return;
  const link = await botShareLink();
  const text = [
    'Please Share bot ni ke 3 group sosial media dulu',
    '',
    `Link bot: ${link}`,
    `Progress share: ${slots.size}/3`,
    '',
    slots.size >= 3
      ? '✅ Selesai 3/3. Bot dah unlock untuk Jumaat ni.'
      : 'Tekan Share #1, kemudian Share #2, kemudian Share #3 selepas korang share.',
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
  if(isPayPingSharedConfigEnabled()&&action.startsWith('friday:share:')){await telegram('answerCallbackQuery',{callback_query_id:callbackQuery?.id,text:'Friday-only mode sudah diganti oleh Force Support harian.',show_alert:true}).catch(()=>{});return true}
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

function modeCommand(mode) {
  if (mode === FRIDAY_SUPPORT_MODE_FORCE) return '/forcesupport';
  if (mode === FRIDAY_SUPPORT_MODE_DONATE) return '/donatesupport';
  if (mode === FRIDAY_SUPPORT_MODE_NORMAL) return '/normalsupport';
  return 'OFF';
}

async function validateAdminPrivate(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return { ok: false, chatId, userId };

  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ Command support mode hanya untuk admin bot.').catch(() => {});
    return { ok: false, chatId, userId };
  }
  if (message?.chat?.type !== 'private') {
    await sendMessage(chatId, '❌ Command support mode hanya boleh digunakan dalam private chat bot.').catch(() => {});
    return { ok: false, chatId, userId };
  }
  return { ok: true, chatId, userId };
}

export async function handleFridaySupportModeCommand(message = {}, mode) {
  const access = await validateAdminPrivate(message);
  if (!access.ok) return true;

  const saved = await setFridaySupportMode(mode, access.userId);
  await sendMessage(
    access.chatId,
    [
      modeHeader(saved),
      'Mode ini akan berjalan setiap Jumaat selagi belum dihentikan dengan command stop yang sepadan.',
      '',
      supportCampaignText(),
    ].join('\n'),
    { reply_markup: supportMenuKeyboard() },
  );
  return true;
}

export async function handleFridaySupportStopCommand(message = {}, expectedMode) {
  const access = await validateAdminPrivate(message);
  if (!access.ok) return true;

  const expected = validMode(expectedMode);
  const current = await getFridaySupportMode();

  if (current === FRIDAY_SUPPORT_MODE_OFF) {
    await sendMessage(
      access.chatId,
      '⏹ Friday Support System memang dah STOP. Guna /forcesupport, /donatesupport atau /normalsupport untuk aktifkan semula.',
    );
    return true;
  }

  if (current !== expected) {
    await sendMessage(
      access.chatId,
      `⚠️ ${modeCommand(expected)} bukan mode yang sedang aktif. Mode sekarang: ${modeCommand(current)}. Sistem tak diubah.`,
    );
    return true;
  }

  await setFridaySupportMode(FRIDAY_SUPPORT_MODE_OFF, access.userId);
  await sendMessage(
    access.chatId,
    `⏹ ${modeCommand(expected)} dihentikan. Friday Support System tak akan berjalan lagi sehingga kau command /forcesupport, /donatesupport atau /normalsupport.`,
  );
  return true;
}
