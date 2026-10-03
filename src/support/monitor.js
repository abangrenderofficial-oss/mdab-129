import { currentSupportEnvironment, getSupportDb } from './store.js';
import { getActiveSupporterTitle } from './community-store.js';
import { ensureSubmissionSchema } from './submissions.js';
import { malaysiaSupportSchedule } from './daily-force-schedule.js';

let schemaPromise = null;

function clean(value, max = 120) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function validUserId(value) {
  const id = Number(value || 0);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : '';
}

async function ensureSchema() {
  await ensureSubmissionSchema();
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS support_user_monitor (
          environment TEXT NOT NULL,
          telegram_user_id TEXT NOT NULL,
          telegram_username TEXT NOT NULL DEFAULT '',
          display_name TEXT NOT NULL DEFAULT '',
          seen_count INTEGER NOT NULL DEFAULT 0,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          PRIMARY KEY (environment, telegram_user_id)
        )`,
        'CREATE INDEX IF NOT EXISTS idx_support_user_monitor_recent ON support_user_monitor(environment, last_seen_at DESC)',
      ], 'write');
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function recordSupportMonitorSeen(actor = {}) {
  const userId = validUserId(actor?.id);
  if (!userId) return false;

  await ensureSchema();
  const db = await getSupportDb();
  const now = new Date().toISOString();
  const username = clean(actor?.username, 64).replace(/^@+/, '');
  const displayName = clean([actor?.first_name, actor?.last_name].filter(Boolean).join(' '), 120);

  const before = await db.execute({
    sql: `SELECT telegram_username, display_name
          FROM support_user_monitor
          WHERE environment = ? AND telegram_user_id = ?
          LIMIT 1`,
    args: [currentSupportEnvironment(), userId],
  });
  const previous = before.rows?.[0] || null;
  const effectiveUsername = username || String(previous?.telegram_username || '');
  const effectiveDisplayName = displayName || String(previous?.display_name || '');
  const changed = !previous
    || effectiveUsername !== String(previous.telegram_username || '')
    || effectiveDisplayName !== String(previous.display_name || '');

  await db.execute({
    sql: `INSERT INTO support_user_monitor (
            environment, telegram_user_id, telegram_username, display_name,
            seen_count, first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(environment, telegram_user_id) DO UPDATE SET
            telegram_username = CASE
              WHEN excluded.telegram_username != '' THEN excluded.telegram_username
              ELSE support_user_monitor.telegram_username
            END,
            display_name = CASE
              WHEN excluded.display_name != '' THEN excluded.display_name
              ELSE support_user_monitor.display_name
            END,
            seen_count = support_user_monitor.seen_count + 1,
            last_seen_at = excluded.last_seen_at`,
    args: [
      currentSupportEnvironment(),
      userId,
      username,
      displayName,
      now,
      now,
    ],
  });
  return { recorded: true, changed, isNew: !previous };
}

async function dailyForceState(userId) {
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  try {
    const mode = await db.execute({
      sql: `SELECT enabled, cycle_id
            FROM support_daily_force_mode
            WHERE environment = ?
            LIMIT 1`,
      args: [environment],
    });
    const enabled = Number(mode.rows?.[0]?.enabled || 0) === 1;
    const cycleId = Math.max(1, Number(mode.rows?.[0]?.cycle_id || 1));
    const schedule = malaysiaSupportSchedule();
    if (!enabled) {
      return {
        enabled: false,
        cycleId,
        usedOnce: false,
        useClaimed: false,
        successCount: 0,
        windowActive: false,
        pausedForFriday: false,
        weekday: schedule.weekday,
      };
    }

    const usage = await db.execute({
      sql: `SELECT used_once, use_claimed, prompt_sent, COALESCE(success_count, 0) AS success_count
            FROM support_daily_force_usage
            WHERE environment = ? AND telegram_user_id = ? AND cycle_id = ?
            LIMIT 1`,
      args: [environment, String(userId), cycleId],
    });
    const row = usage.rows?.[0] || {};
    return {
      enabled: true,
      cycleId,
      usedOnce: Number(row.used_once || 0) === 1,
      useClaimed: Number(row.use_claimed || 0) === 1,
      promptSent: Number(row.prompt_sent || 0) === 1,
      successCount: Math.max(0, Number(row.success_count || 0)),
      windowActive: schedule.dailyForceWindowActive,
      pausedForFriday: schedule.isFriday,
      weekday: schedule.weekday,
    };
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || ''))) {
      const schedule = malaysiaSupportSchedule();
      return {
        enabled: false,
        cycleId: 0,
        usedOnce: false,
        useClaimed: false,
        successCount: 0,
        windowActive: false,
        pausedForFriday: false,
        weekday: schedule.weekday,
      };
    }
    throw error;
  }
}

async function monitorProfile(userId) {
  await ensureSchema();
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT telegram_username, display_name, seen_count, first_seen_at, last_seen_at
          FROM support_user_monitor
          WHERE environment = ? AND telegram_user_id = ?
          LIMIT 1`,
    args: [currentSupportEnvironment(), String(userId)],
  });
  const row = result.rows?.[0] || {};
  let username = String(row.telegram_username || '');
  let displayName = String(row.display_name || '');

  if (!username || !displayName) {
    const fallback = await db.execute({
      sql: `SELECT o.telegram_username,
                   COALESCE(s.display_name, '') AS display_name
            FROM support_orders o
            LEFT JOIN support_submissions s
              ON s.environment = o.environment
             AND s.order_number = o.order_number
            WHERE o.environment = ? AND o.telegram_user_id = ?
            ORDER BY COALESCE(o.paid_at, o.updated_at, o.created_at) DESC
            LIMIT 1`,
      args: [currentSupportEnvironment(), String(userId)],
    });
    const supportRow = fallback.rows?.[0] || {};
    if (!username) username = String(supportRow.telegram_username || '');
    if (!displayName) displayName = String(supportRow.display_name || '');
  }

  return {
    username,
    displayName,
    seenCount: Number(row.seen_count || 0),
    firstSeenAt: String(row.first_seen_at || ''),
    lastSeenAt: String(row.last_seen_at || ''),
  };
}

export async function getSupportMonitorUserStatus(userId) {
  const id = validUserId(userId);
  if (!id) return null;

  const [supporter, daily, profile] = await Promise.all([
    getActiveSupporterTitle(id),
    dailyForceState(id),
    monitorProfile(id),
  ]);

  let dailyState = 'OFF';
  if (supporter) dailyState = 'EXEMPT_SUPPORTER';
  else if (daily.enabled && daily.pausedForFriday) dailyState = 'PAUSED_FRIDAY';
  else if (daily.enabled && daily.windowActive && (daily.usedOnce || daily.useClaimed)) dailyState = 'LOCKED';
  else if (daily.enabled && daily.windowActive) dailyState = 'FREE_USE_AVAILABLE';

  return {
    userId: id,
    username: profile.username,
    displayName: profile.displayName,
    support: supporter ? {
      active: true,
      tierLabel: supporter.tierLabel,
      amount: supporter.amount,
      paidAt: supporter.paidAt,
      expiresAt: supporter.expiresAt,
      orderNumber: supporter.orderNumber,
    } : { active: false },
    dailyForce: {
      ...daily,
      state: dailyState,
      anomaly: !supporter && daily.enabled && daily.successCount > 1,
    },
    monitor: profile,
  };
}

async function knownUserIds(limit = 50) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const ownerId = validUserId(process.env.BOT_OWNER_ID);
  const safeLimit = Math.max(1, Math.min(80, Number(limit || 50)));

  const result = await db.execute({
    sql: `WITH known_users AS (
            SELECT telegram_user_id AS user_id, last_seen_at AS activity_at
            FROM support_user_monitor
            WHERE environment = ?
            UNION ALL
            SELECT telegram_user_id AS user_id, COALESCE(paid_at, updated_at, created_at) AS activity_at
            FROM support_orders
            WHERE environment = ?
            UNION ALL
            SELECT telegram_user_id AS user_id, updated_at AS activity_at
            FROM support_daily_force_usage
            WHERE environment = ?
          )
          SELECT user_id, MAX(activity_at) AS last_activity
          FROM known_users
          WHERE user_id != ''
            AND (? = '' OR user_id != ?)
          GROUP BY user_id
          ORDER BY last_activity DESC
          LIMIT ?`,
    args: [environment, environment, environment, ownerId, ownerId, safeLimit],
  });
  return (result.rows || []).map((row) => String(row.user_id || '')).filter(Boolean);
}

export async function getSupportMonitorReport(limit = 50) {
  const ids = await knownUserIds(limit);
  const users = (await Promise.all(ids.map((id) => getSupportMonitorUserStatus(id))))
    .filter(Boolean);
  const schedule = malaysiaSupportSchedule();
  let modeSummary = {
    enabled: false,
    cycleId: 0,
    windowActive: false,
    pausedForFriday: false,
  };
  try {
    const db = await getSupportDb();
    const mode = await db.execute({
      sql: `SELECT enabled, cycle_id
            FROM support_daily_force_mode
            WHERE environment = ?
            LIMIT 1`,
      args: [currentSupportEnvironment()],
    });
    const enabled = Number(mode.rows?.[0]?.enabled || 0) === 1;
    const cycleId = Math.max(1, Number(mode.rows?.[0]?.cycle_id || 1));
    modeSummary = {
      enabled,
      cycleId,
      windowActive: enabled && schedule.dailyForceWindowActive,
      pausedForFriday: enabled && schedule.isFriday,
    };
  } catch (error) {
    if (!/no such table/i.test(String(error?.message || ''))) throw error;
  }

  return {
    users,
    supported: users.filter((user) => user.support.active),
    unsupported: users.filter((user) => !user.support.active),
    locked: users.filter((user) => !user.support.active && user.dailyForce.state === 'LOCKED'),
    anomalies: users.filter((user) => user.dailyForce.anomaly),
    dailyForceEnabled: modeSummary.enabled,
    dailyForceWindowActive: modeSummary.windowActive,
    dailyForcePausedForFriday: modeSummary.pausedForFriday,
    weekday: schedule.weekday,
    cycleId: modeSummary.cycleId,
    limit: Math.max(1, Math.min(80, Number(limit || 50))),
  };
}
