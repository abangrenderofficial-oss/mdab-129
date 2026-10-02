import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import { supportMenuKeyboard } from '../features/support.js';
import { getActiveSupporterTitle } from './community-store.js';
import { currentSupportEnvironment, getSupportDb } from './store.js';

let schemaPromise = null;

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.execute(`CREATE TABLE IF NOT EXISTS support_daily_force_mode (
        environment TEXT NOT NULL PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`);
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function isDailyForceSupportEnabled() {
  await ensureSchema();
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT enabled FROM support_daily_force_mode
          WHERE environment = ?
          LIMIT 1`,
    args: [currentSupportEnvironment()],
  });
  return Number(result.rows?.[0]?.enabled || 0) === 1;
}

async function setDailyForceSupportEnabled(enabled, adminUserId = '') {
  await ensureSchema();
  const db = await getSupportDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO support_daily_force_mode (environment, enabled, updated_by, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(environment) DO UPDATE SET
            enabled = excluded.enabled,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
    args: [
      currentSupportEnvironment(),
      enabled ? 1 : 0,
      String(adminUserId || ''),
      now,
    ],
  });
  return Boolean(enabled);
}

function isUsageAttempt(message = {}) {
  if (Array.isArray(message?.photo) && message.photo.length) return true;
  if (message?.video?.file_id) return true;
  const text = String(message?.text || message?.caption || '').trim();
  if (/^\/status(?:@\w+)?(?:\s|$)/i.test(text)) return true;
  return /https?:\/\/\S+/i.test(text);
}

async function sendDailyForceLock(chatId) {
  await sendMessage(
    chatId,
    [
      'Please Support Kita dulu utk guna Bot ❤️',
      '',
      'Support sekali dan selagi title Supporter masih aktif, bot boleh guna macam biasa ✨',
    ].join('\n'),
    { reply_markup: supportMenuKeyboard() },
  );
}

async function shouldGate(userId) {
  if (isResetAdmin(userId)) return false;
  if (!(await isDailyForceSupportEnabled())) return false;
  return !(await getActiveSupporterTitle(userId));
}

export async function enforceDailyForceSupportForMessage(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId || message?.chat?.type !== 'private') return false;
  if (!isUsageAttempt(message)) return false;
  if (!(await shouldGate(userId))) return false;

  await sendDailyForceLock(chatId).catch(() => {});
  return true;
}

export async function enforceDailyForceSupportForCallback(callbackQuery = {}) {
  const chatId = callbackQuery?.message?.chat?.id;
  const chatType = callbackQuery?.message?.chat?.type;
  const userId = callbackQuery?.from?.id;
  if (!chatId || !userId || chatType !== 'private') return false;
  if (!(await shouldGate(userId))) return false;

  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery?.id,
    text: 'Please Support Kita dulu utk guna Bot ❤️',
    show_alert: true,
  }).catch(() => {});
  await sendDailyForceLock(chatId).catch(() => {});
  return true;
}

async function validateAdminPrivate(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return { ok: false, chatId, userId };

  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ /forcesupportdaily hanya untuk admin bot.').catch(() => {});
    return { ok: false, chatId, userId };
  }

  if (message?.chat?.type !== 'private') {
    await sendMessage(chatId, '❌ /forcesupportdaily hanya boleh digunakan dalam private chat bot.').catch(() => {});
    return { ok: false, chatId, userId };
  }

  return { ok: true, chatId, userId };
}

export async function handleDailyForceSupportCommand(message = {}) {
  const access = await validateAdminPrivate(message);
  if (!access.ok) return true;

  const alreadyEnabled = await isDailyForceSupportEnabled();
  await setDailyForceSupportEnabled(true, access.userId);
  await sendMessage(
    access.chatId,
    alreadyEnabled
      ? '🔒 /forcesupportdaily memang dah aktif. Non-supporter akan terus kena lock setiap hari sehingga support.'
      : '🔒 /forcesupportdaily aktif. Non-supporter tak boleh guna fungsi downloader setiap hari sehingga support. Supporter aktif boleh guna macam biasa. Mode ini kekal aktif sampai /stopforcesupportdaily.',
  );
  return true;
}

export async function handleStopDailyForceSupportCommand(message = {}) {
  const access = await validateAdminPrivate(message);
  if (!access.ok) return true;

  const enabled = await isDailyForceSupportEnabled();
  if (!enabled) {
    await sendMessage(access.chatId, '⏹ /forcesupportdaily memang dah STOP.');
    return true;
  }

  await setDailyForceSupportEnabled(false, access.userId);
  await sendMessage(
    access.chatId,
    '⏹ /forcesupportdaily dihentikan. Daily hard lock tak akan berjalan sehingga kau aktifkan semula /forcesupportdaily.',
  );
  return true;
}
