import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import { refreshSupportMonitorMessage } from './monitor-publisher.js';
import { dailyForcePremiumSupportText, supportAmountKeyboard } from '../features/support.js';
import { getActiveSupporterTitle } from './community-store.js';
import { currentSupportEnvironment, getSupportDb } from './store.js';
import { malaysiaSupportSchedule } from './daily-force-schedule.js';

const DAILY_FORCE_COPY = 'Please support bot utk teruskan guna ❤️';
const DAILY_FORCE_PROCESSING_COPY = '⏳ Premium+ HQ sedang diproses. Tunggu sampai siap dulu ya.';
let schemaPromise = null;

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS support_daily_force_mode (
          environment TEXT NOT NULL PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          cycle_id INTEGER NOT NULL DEFAULT 1,
          updated_by TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS support_daily_force_usage (
          environment TEXT NOT NULL,
          telegram_user_id TEXT NOT NULL,
          cycle_id INTEGER NOT NULL,
          used_once INTEGER NOT NULL DEFAULT 0,
          use_claimed INTEGER NOT NULL DEFAULT 0,
          prompt_sent INTEGER NOT NULL DEFAULT 0,
          success_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, telegram_user_id, cycle_id)
        )`,
      ], 'write');

      const modeColumns = await db.execute('PRAGMA table_info(support_daily_force_mode)');
      const hasCycleId = (modeColumns.rows || []).some((row) => String(row.name || '') === 'cycle_id');
      if (!hasCycleId) {
        await db.execute(
          'ALTER TABLE support_daily_force_mode ADD COLUMN cycle_id INTEGER NOT NULL DEFAULT 1',
        );
      }

      const usageColumns = await db.execute('PRAGMA table_info(support_daily_force_usage)');
      const hasSuccessCount = (usageColumns.rows || []).some((row) => String(row.name || '') === 'success_count');
      if (!hasSuccessCount) {
        await db.execute(
          'ALTER TABLE support_daily_force_usage ADD COLUMN success_count INTEGER NOT NULL DEFAULT 0',
        );
        await db.execute(
          'UPDATE support_daily_force_usage SET success_count = 1 WHERE used_once = 1 AND success_count = 0',
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

async function modeState() {
  await ensureSchema();
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT enabled, cycle_id
          FROM support_daily_force_mode
          WHERE environment = ?
          LIMIT 1`,
    args: [currentSupportEnvironment()],
  });
  return {
    enabled: Number(result.rows?.[0]?.enabled || 0) === 1,
    cycleId: Math.max(1, Number(result.rows?.[0]?.cycle_id || 1)),
  };
}

export async function isDailyForceSupportEnabled() {
  return (await modeState()).enabled;
}

export async function getDailyForceRuntimeState(date = new Date()) {
  const mode = await modeState();
  const schedule = malaysiaSupportSchedule(date);
  return {
    ...mode,
    ...schedule,
    active: mode.enabled && schedule.dailyForceWindowActive,
    pausedForFriday: mode.enabled && schedule.isFriday,
  };
}

async function setDailyForceSupportEnabled(enabled, adminUserId = '') {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const current = await modeState();
  const nextCycleId = enabled && !current.enabled ? current.cycleId + 1 : current.cycleId;
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO support_daily_force_mode (
            environment, enabled, cycle_id, updated_by, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(environment) DO UPDATE SET
            enabled = excluded.enabled,
            cycle_id = excluded.cycle_id,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
    args: [
      environment,
      enabled ? 1 : 0,
      nextCycleId,
      String(adminUserId || ''),
      now,
    ],
  });
  return { enabled: Boolean(enabled), cycleId: nextCycleId };
}

function isUsageAttempt(message = {}) {
  if (Array.isArray(message?.photo) && message.photo.length) return true;
  if (message?.video?.file_id) return true;
  const text = String(message?.text || message?.caption || '').trim();
  if (/^\/status(?:@\w+)?(?:\s|$)/i.test(text)) return true;
  return /https?:\/\/\S+/i.test(text);
}

async function usageState(userId, cycleId) {
  await ensureSchema();
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT used_once, use_claimed, prompt_sent, COALESCE(success_count, 0) AS success_count
          FROM support_daily_force_usage
          WHERE environment = ? AND telegram_user_id = ? AND cycle_id = ?
          LIMIT 1`,
    args: [currentSupportEnvironment(), String(userId), Number(cycleId)],
  });
  return {
    usedOnce: Number(result.rows?.[0]?.used_once || 0) === 1,
    useClaimed: Number(result.rows?.[0]?.use_claimed || 0) === 1,
    promptSent: Number(result.rows?.[0]?.prompt_sent || 0) === 1,
    successCount: Math.max(0, Number(result.rows?.[0]?.success_count || 0)),
  };
}

async function sendDailyForceLock(chatId) {
  await sendMessage(
    chatId,
    DAILY_FORCE_COPY,
    { reply_markup: supportAmountKeyboard() },
  );
}

async function sendDailyForceFirstSuccessPrompt(chatId) {
  await sendMessage(
    chatId,
    dailyForcePremiumSupportText(),
    { reply_markup: supportAmountKeyboard() },
  );
}

async function accessContext(userId) {
  if (isResetAdmin(userId)) return { gated: false, enabled: false, cycleId: 0 };
  const mode = await modeState();
  if (!mode.enabled) return { gated: false, ...mode };

  const schedule = malaysiaSupportSchedule();
  if (!schedule.dailyForceWindowActive) {
    return {
      gated: false,
      ...mode,
      ...schedule,
      pausedForFriday: true,
    };
  }

  const supporter = await getActiveSupporterTitle(userId);
  if (supporter) return { gated: false, ...mode, supporter };

  const state = await usageState(userId, mode.cycleId);
  return {
    gated: state.usedOnce || state.useClaimed,
    gateReason: state.usedOnce
      ? 'support_required'
      : (state.useClaimed ? 'processing_first_use' : ''),
    ...mode,
    supporter: null,
    state,
  };
}

export async function claimDailyForceUsageAttempt(userId) {
  const id = Number(userId || 0);
  if (!Number.isSafeInteger(id) || id <= 0 || isResetAdmin(id)) return false;

  const mode = await modeState();
  if (!mode.enabled) return false;
  if (!malaysiaSupportSchedule().dailyForceWindowActive) return false;
  if (await getActiveSupporterTitle(id)) return false;

  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT OR IGNORE INTO support_daily_force_usage (
            environment, telegram_user_id, cycle_id,
            used_once, use_claimed, prompt_sent, success_count, updated_at
          ) VALUES (?, ?, ?, 0, 0, 0, 0, ?)`,
    args: [environment, String(id), mode.cycleId, now],
  });

  const claimed = await db.execute({
    sql: `UPDATE support_daily_force_usage
          SET use_claimed = 1, updated_at = ?
          WHERE environment = ? AND telegram_user_id = ? AND cycle_id = ?
            AND used_once = 0 AND use_claimed = 0`,
    args: [now, environment, String(id), mode.cycleId],
  });
  return Number(claimed.rowsAffected || 0) > 0;
}

export async function releaseDailyForceUsageAttempt(userId) {
  const id = Number(userId || 0);
  if (!Number.isSafeInteger(id) || id <= 0) return false;

  const mode = await modeState();
  if (!mode.enabled) return false;

  const db = await getSupportDb();
  const result = await db.execute({
    sql: `UPDATE support_daily_force_usage
          SET use_claimed = 0, updated_at = ?
          WHERE environment = ? AND telegram_user_id = ? AND cycle_id = ?
            AND used_once = 0 AND use_claimed = 1`,
    args: [
      new Date().toISOString(),
      currentSupportEnvironment(),
      String(id),
      mode.cycleId,
    ],
  });
  return Number(result.rowsAffected || 0) > 0;
}

export async function markDailyForceUsageSuccess(userId) {
  const id = Number(userId || 0);
  if (!Number.isSafeInteger(id) || id <= 0 || isResetAdmin(id)) return false;

  const mode = await modeState();
  if (!mode.enabled) return false;
  if (!malaysiaSupportSchedule().dailyForceWindowActive) return false;
  if (await getActiveSupporterTitle(id)) return false;

  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT OR IGNORE INTO support_daily_force_usage (
            environment, telegram_user_id, cycle_id,
            used_once, use_claimed, prompt_sent, success_count, updated_at
          ) VALUES (?, ?, ?, 0, 0, 0, 0, ?)`,
    args: [environment, String(id), mode.cycleId, now],
  });

  const completed = await db.execute({
    sql: `UPDATE support_daily_force_usage
          SET used_once = 1,
              use_claimed = 0,
              success_count = COALESCE(success_count, 0) + 1,
              updated_at = ?
          WHERE environment = ? AND telegram_user_id = ? AND cycle_id = ?
            AND used_once = 0`,
    args: [now, environment, String(id), mode.cycleId],
  });

  if (Number(completed.rowsAffected || 0) < 1) {
    return false;
  }

  const prompt = await db.execute({
    sql: `UPDATE support_daily_force_usage
          SET prompt_sent = 1, updated_at = ?
          WHERE environment = ? AND telegram_user_id = ? AND cycle_id = ?
            AND prompt_sent = 0`,
    args: [now, environment, String(id), mode.cycleId],
  });

  if (Number(prompt.rowsAffected || 0) > 0) {
    await sendDailyForceFirstSuccessPrompt(id).catch((error) => {
      console.warn('[daily-force] first-use support prompt failed:', error?.message);
    });
  }

  await refreshSupportMonitorMessage().catch((error) => {
    console.warn('[support-monitor] refresh after Daily Force success failed:', error?.message);
  });
  return true;
}

export async function enforceDailyForceSupportForMessage(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId || message?.chat?.type !== 'private') return false;
  if (!isUsageAttempt(message)) return false;

  const context = await accessContext(userId);
  if (!context.gated) return false;

  if (context.gateReason === 'processing_first_use') {
    await sendMessage(chatId, DAILY_FORCE_PROCESSING_COPY).catch(() => {});
    return true;
  }

  await sendDailyForceLock(chatId).catch(() => {});
  return true;
}

export async function enforceDailyForceSupportForCallback(callbackQuery = {}) {
  const chatId = callbackQuery?.message?.chat?.id;
  const chatType = callbackQuery?.message?.chat?.type;
  const userId = callbackQuery?.from?.id;
  if (!chatId || !userId || chatType !== 'private') return false;

  const context = await accessContext(userId);
  if (!context.gated) return false;

  const copy = context.gateReason === 'processing_first_use'
    ? DAILY_FORCE_PROCESSING_COPY
    : DAILY_FORCE_COPY;
  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery?.id,
    text: copy,
    show_alert: true,
  }).catch(() => {});

  if (context.gateReason !== 'processing_first_use') {
    await sendDailyForceLock(chatId).catch(() => {});
  }
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
  const saved = await setDailyForceSupportEnabled(true, access.userId);
  await sendMessage(
    access.chatId,
    alreadyEnabled
      ? [
          '🔒 /forcesupportdaily memang dah aktif.',
          'Jadual: Sabtu sampai Khamis (Malaysia time).',
          'Jumaat Daily Force auto-pause dan Friday Support System ambil alih.',
          'Ia kekal ON sampai kau guna /stopforcesupportdaily.',
          `Cycle: ${saved.cycleId}`,
        ].join('\n')
      : [
          '🔒 /forcesupportdaily aktif.',
          'Jadual: Sabtu sampai Khamis (Malaysia time).',
          'Non-supporter dapat 1 successful Premium+ HQ dahulu.',
          'Selepas Premium+ HQ pertama berjaya diproses, bot terus minta support dengan pilihan RM10/RM20/RM30/RM50/RM100.',
          'Cubaan seterusnya kekal locked sampai support.',
          'Jumaat Daily Force auto-pause; /forcesupport, /donatesupport atau /normalsupport akan handle.',
          'Sabtu ia sambung semula secara automatik.',
          'Ia kekal ON sampai kau guna /stopforcesupportdaily.',
          `Cycle: ${saved.cycleId}`,
        ].join('\n'),
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
    '⏹ /forcesupportdaily dihentikan sepenuhnya. Sabtu–Khamis tak akan berjalan lagi sehingga kau aktifkan semula /forcesupportdaily.',
  );
  return true;
}
