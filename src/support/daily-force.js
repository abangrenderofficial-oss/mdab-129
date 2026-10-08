import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import { refreshSupportMonitorMessage } from './monitor-publisher.js';
import { supportAmountKeyboard } from '../features/support.js';
import { getActiveSupporterTitle } from './community-store.js';
import { currentSupportEnvironment, getSupportDb } from './store.js';
import { malaysiaSupportSchedule } from './daily-force-schedule.js';
import {isPayPingSharedConfigEnabled,publishSharedForceState} from './payping-shared-config.js';

const DAILY_FORCE_COPY = 'Please support bot utk teruskan guna ❤️';
const DAILY_FORCE_PROCESSING_COPY = '⏳ Penggunaan pertama sedang diproses. Tunggu sampai siap dulu ya.';
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
          policy_version INTEGER NOT NULL DEFAULT 3,
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
        `CREATE TABLE IF NOT EXISTS support_daily_force_first_hq (
          environment TEXT NOT NULL,
          telegram_user_id TEXT NOT NULL,
          cycle_id INTEGER NOT NULL,
          raw_completed_at TEXT NOT NULL,
          hq_completed_at TEXT NOT NULL DEFAULT '',
          PRIMARY KEY(environment, telegram_user_id, cycle_id)
        )`,
      ], 'write');

      const modeColumns = await db.execute('PRAGMA table_info(support_daily_force_mode)');
      const hasCycleId = (modeColumns.rows || []).some((row) => String(row.name || '') === 'cycle_id');
      if (!hasCycleId) {
        await db.execute(
          'ALTER TABLE support_daily_force_mode ADD COLUMN cycle_id INTEGER NOT NULL DEFAULT 1',
        );
      }

      const refreshedModeColumns = await db.execute('PRAGMA table_info(support_daily_force_mode)');
      const hasPolicyVersion = (refreshedModeColumns.rows || []).some((row) => String(row.name || '') === 'policy_version');
      if (!hasPolicyVersion) {
        await db.execute(
          'ALTER TABLE support_daily_force_mode ADD COLUMN policy_version INTEGER NOT NULL DEFAULT 1',
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

      const environment = currentSupportEnvironment();
      const policy = await db.execute({
        sql: `SELECT cycle_id, policy_version
              FROM support_daily_force_mode
              WHERE environment = ?
              LIMIT 1`,
        args: [environment],
      });
      const policyRow = policy.rows?.[0];
      if (policyRow && Number(policyRow.policy_version || 1) < 3) {
        const now = new Date().toISOString();
        await db.execute({
          sql: `UPDATE support_daily_force_mode
                SET policy_version = 3, updated_at = ?
                WHERE environment = ?`,
          args: [now, environment],
        });
        console.log('[daily-force] restored one-free-success policy without resetting current cycle');
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
    sql: `SELECT enabled, cycle_id, policy_version
          FROM support_daily_force_mode
          WHERE environment = ?
          LIMIT 1`,
    args: [currentSupportEnvironment()],
  });
  return {
    enabled: Number(result.rows?.[0]?.enabled || 0) === 1,
    cycleId: Math.max(1, Number(result.rows?.[0]?.cycle_id || 1)),
    policyVersion: Math.max(1, Number(result.rows?.[0]?.policy_version || 3)),
  };
}

export async function repairDailyForceCurrentCycleUsers(rawUserIds = process.env.DAILY_FORCE_REPAIR_USER_IDS || '') {
  const ids = [...new Set(
    String(rawUserIds || '')
      .split(',')
      .map((value) => Number(String(value || '').trim()))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  )];
  if (!ids.length) return { attempted: 0, repaired: 0, skippedSupporters: 0 };

  const mode = await modeState();
  if (!mode.enabled) {
    return { attempted: ids.length, repaired: 0, skippedSupporters: 0, reason: 'daily_force_disabled' };
  }

  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  let repaired = 0;
  let skippedSupporters = 0;

  for (const id of ids) {
    if (isResetAdmin(id)) continue;
    if (await getActiveSupporterTitle(id)) {
      skippedSupporters += 1;
      continue;
    }

    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT OR IGNORE INTO support_daily_force_usage (
              environment, telegram_user_id, cycle_id,
              used_once, use_claimed, prompt_sent, success_count, updated_at
            ) VALUES (?, ?, ?, 1, 0, 0, 1, ?)`,
      args: [environment, String(id), mode.cycleId, now],
    });

    const result = await db.execute({
      sql: `UPDATE support_daily_force_usage
            SET used_once = 1,
                use_claimed = 0,
                success_count = CASE
                  WHEN COALESCE(success_count, 0) < 1 THEN 1
                  ELSE success_count
                END,
                updated_at = ?
            WHERE environment = ? AND telegram_user_id = ? AND cycle_id = ?`,
      args: [now, environment, String(id), mode.cycleId],
    });
    if (Number(result.rowsAffected || 0) > 0) repaired += 1;
  }

  if (repaired > 0) {
    await refreshSupportMonitorMessage().catch((error) => {
      console.warn('[support-monitor] refresh after Daily Force repair failed:', error?.message);
    });
  }

  return {
    attempted: ids.length,
    repaired,
    skippedSupporters,
    cycleId: mode.cycleId,
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
    pausedForFriday: mode.enabled && !schedule.dailyForceWindowActive && schedule.isFriday,
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
            environment, enabled, cycle_id, updated_by, policy_version, updated_at
          ) VALUES (?, ?, ?, ?, 3, ?)
          ON CONFLICT(environment) DO UPDATE SET
            enabled = excluded.enabled,
            cycle_id = excluded.cycle_id,
            updated_by = excluded.updated_by,
            policy_version = 3,
            updated_at = excluded.updated_at`,
    args: [
      environment,
      enabled ? 1 : 0,
      nextCycleId,
      String(adminUserId || ''),
      now,
    ],
  });
  if(isPayPingSharedConfigEnabled()) await publishSharedForceState(Boolean(enabled), 'telegram');
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

export async function markDailyForceUsageSuccess(userId, { allowFirstHq = false } = {}) {
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

  // A raw photo/video/link is one free session. Its original HQ button
  // remains usable once AFTER raw media is delivered, not as a second use.
  // Do not send any support promotion on the first successful delivery.
  if (allowFirstHq) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO support_daily_force_first_hq (
              environment, telegram_user_id, cycle_id, raw_completed_at, hq_completed_at
            ) VALUES (?,?,?,?, '')`,
      args: [environment, String(id), mode.cycleId, now],
    }).catch(error => console.warn('[daily-force] first HQ session save failed:',error?.message));
  }

  await refreshSupportMonitorMessage().catch((error) => {
    console.warn('[support-monitor] refresh after Daily Force success failed:', error?.message);
  });
  return true;
}

// Valid only for the Premium+ HQ/Android HQ button on the first delivered
// Telegram media. The NEXT incoming source still receives the support lock.
export async function canFinishFirstDailyForceHq(callbackQuery = {}) {
  const id = Number(callbackQuery?.from?.id || 0);
  if (!Number.isSafeInteger(id) || id <= 0 || isResetAdmin(id)) return false;
  if (callbackQuery?.message?.chat?.type !== 'private') return false;
  if (!callbackQuery?.message?.video && !callbackQuery?.message?.photo?.length) return false;
  const mode=await modeState();
  if(!mode.enabled || !malaysiaSupportSchedule().dailyForceWindowActive)return false;
  const db=await getSupportDb();
  const r=await db.execute({
    sql:`SELECT s.raw_completed_at,s.hq_completed_at
         FROM support_daily_force_first_hq s
         JOIN support_daily_force_usage u
           ON u.environment=s.environment AND u.telegram_user_id=s.telegram_user_id AND u.cycle_id=s.cycle_id
         WHERE s.environment=? AND s.telegram_user_id=? AND s.cycle_id=? AND u.used_once=1 LIMIT 1`,
    args:[currentSupportEnvironment(),String(id),mode.cycleId],
  });
  let record=r.rows?.[0];
  if(!record){
    // Backward-compatible grace for users who received the premature promo
    // just before this fix. Only their ORIGINAL media button can use it.
    const previous=await db.execute({
      sql:`SELECT used_once,use_claimed,prompt_sent,success_count,updated_at
           FROM support_daily_force_usage
           WHERE environment=? AND telegram_user_id=? AND cycle_id=? LIMIT 1`,
      args:[currentSupportEnvironment(),String(id),mode.cycleId],
    });
    const old=previous.rows?.[0],oldTime=Date.parse(String(old?.updated_at||''));
    const mediaDate=Number(callbackQuery?.message?.date||0)*1000;
    if(Number(old?.used_once)===1 && Number(old?.prompt_sent)===1
       && Number(old?.success_count)===1 && Number(old?.use_claimed)===0
       && Number.isFinite(oldTime) && Date.now()-oldTime>=0
       && Date.now()-oldTime<4*3_600_000
       && Number.isFinite(mediaDate) && mediaDate>=oldTime-120_000 && mediaDate<=oldTime+120_000){
      await db.execute({
        sql:`INSERT OR IGNORE INTO support_daily_force_first_hq
             (environment,telegram_user_id,cycle_id,raw_completed_at,hq_completed_at)
             VALUES(?,?,?,?, '')`,
        args:[currentSupportEnvironment(),String(id),mode.cycleId,new Date(oldTime).toISOString()],
      });
      const justCreated=await db.execute({
        sql:`SELECT raw_completed_at,hq_completed_at FROM support_daily_force_first_hq
             WHERE environment=? AND telegram_user_id=? AND cycle_id=? LIMIT 1`,
        args:[currentSupportEnvironment(),String(id),mode.cycleId],
      });
      record=justCreated.rows?.[0];
    }
  }
  if(!record || record.hq_completed_at)return false;
  const first=Date.parse(String(record.raw_completed_at||''));
  const mediaDate=Number(callbackQuery?.message?.date||0)*1000;
  if(!Number.isFinite(first)||!Number.isFinite(mediaDate)||!mediaDate)return false;
  // Telegram messages are second-resolution; allow 2 min tolerance around
  // the source delivery, with a 24 h expiry for the original HQ button.
  return mediaDate>=first-120_000 && Date.now()-first<86_400_000;
}

export async function completeFirstDailyForceHq(userId){
  const id=Number(userId||0);
  if(!Number.isSafeInteger(id)||id<=0)return false;
  const mode=await modeState();
  if(!mode.enabled)return false;
  const db=await getSupportDb();
  const r=await db.execute({
    sql:`UPDATE support_daily_force_first_hq SET hq_completed_at=?
          WHERE environment=? AND telegram_user_id=? AND cycle_id=? AND hq_completed_at=''`,
    args:[new Date().toISOString(),currentSupportEnvironment(),String(id),mode.cycleId],
  });
  return Number(r.rowsAffected||0)>0;
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
  if (context.gateReason === 'support_required' && await canFinishFirstDailyForceHq(callbackQuery))return false;

  const copy = context.gateReason === 'processing_first_use'
    ? DAILY_FORCE_PROCESSING_COPY
    : DAILY_FORCE_COPY;
  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQuery?.id,
    text: copy,
    show_alert: true,
  }).catch(() => {});

  // Promotional payment buttons are sent only when a NEW link/photo/video
  // arrives, never simply because an old HQ button was tapped.
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
  if(isPayPingSharedConfigEnabled()){
    await sendMessage(access.chatId,`🔒 Force Support ${alreadyEnabled?'memang dah aktif':'aktif'} untuk SETIAP HARI termasuk Jumaat.\n\nPengguna bukan supporter boleh guna 1 kali berjaya secara percuma; cubaan seterusnya locked sehingga support.\n\nAmaun ikut Support Plans PayPing. Guna /normalsupport untuk FREE atau /stopforcesupport untuk OFF.\n\nCycle: ${saved.cycleId}`);
    return true;
  }
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
          'Non-supporter dapat 1 successful use dahulu (download, upload, Status HQ, slideshow atau Live Wallpaper).',
          'Selepas penggunaan pertama berjaya, bot terus minta support dengan pilihan RM10/RM20/RM30/RM50/RM100.',
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
  if(isPayPingSharedConfigEnabled()){
    await sendMessage(access.chatId,'🔓 Force Support OFF. Bot kembali ke Free Mode setiap hari. Status PayPing dikemaskini.');
    return true;
  }
  await sendMessage(
    access.chatId,
    '⏹ /forcesupportdaily dihentikan sepenuhnya. Sabtu–Khamis tak akan berjalan lagi sehingga kau aktifkan semula /forcesupportdaily.',
  );
  return true;
}
