import { createHash } from 'node:crypto';
import { currentSupportEnvironment, getSupportDb } from './store.js';
import { getPaymentDetailGroup } from './payment-detail.js';
import { getSupportMonitorReport } from './monitor.js';
import { sendMessage, telegram } from '../telegram.js';

let schemaPromise = null;

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.execute(`
        CREATE TABLE IF NOT EXISTS support_monitor_message (
          environment TEXT NOT NULL PRIMARY KEY,
          group_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          content_hash TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        )
      `);
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function shortDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function identity(user = {}) {
  if (user.username) return `@${user.username}`;
  if (user.displayName) return user.displayName;
  return `ID ${user.userId || '-'}`;
}

function supportLine(user = {}) {
  return `✅ ${identity(user)} · ID ${user.userId} · ${user.support.tierLabel} · exp ${shortDate(user.support.expiresAt)}`;
}

function unsupportedLine(user = {}) {
  const daily = user.dailyForce || {};
  if (daily.anomaly) {
    return `⚠️ ${identity(user)} · ID ${user.userId} · ANOMALY · success ${daily.successCount}x · cycle ${daily.cycleId}`;
  }
  if (daily.state === 'LOCKED') {
    return `🔒 ${identity(user)} · ID ${user.userId} · LOCKED · success ${daily.successCount}x · cycle ${daily.cycleId}`;
  }
  if (daily.state === 'PAUSED_FRIDAY') {
    return `⏸ ${identity(user)} · ID ${user.userId} · FRIDAY MODE`;
  }
  if (daily.state === 'PROCESSING_FIRST_USE') {
    return `⏳ ${identity(user)} · ID ${user.userId} · PROCESSING FIRST USE · cycle ${daily.cycleId}`;
  }
  if (daily.state === 'FREE_USE_AVAILABLE') {
    return `❌ ${identity(user)} · ID ${user.userId} · FREE 1x available · cycle ${daily.cycleId}`;
  }
  return `❌ ${identity(user)} · ID ${user.userId} · BELUM SUPPORT · Daily Force OFF`;
}

function pushSection(lines, title, users, formatter, limit = 30) {
  lines.push('', title);
  if (!users.length) {
    lines.push('- Tiada -');
    return;
  }

  let count = 0;
  for (const user of users) {
    if (count >= limit) break;
    const line = formatter(user);
    const projected = [...lines, line].join('\n');
    if (projected.length > 3600) {
      lines.push(`… +${users.length - count} lagi (guna /supportmonitor untuk full list)`);
      return;
    }
    lines.push(line);
    count += 1;
  }
  if (users.length > count) {
    lines.push(`… +${users.length - count} lagi (guna /supportmonitor untuk full list)`);
  }
}

export function buildSupportMonitorMessage(report = {}) {
  const lines = [
    '📊 SUPPORT MONITOR — AUTO',
    '',
    report.dailyForceEnabled
      ? (
          report.dailyForcePausedForFriday
            ? `Daily Force: ON · PAUSED FRIDAY · Cycle ${report.cycleId}`
            : `Daily Force: ON · Sabtu–Khamis · Cycle ${report.cycleId}`
        )
      : 'Daily Force: OFF',
    `Tracked users: ${report.users?.length || 0}`,
    `✅ Active supporter: ${report.supported?.length || 0}`,
    `❌ Belum support: ${report.unsupported?.length || 0}`,
    `🔒 Locked: ${report.locked?.length || 0}`,
    `⚠️ Anomaly (>1 success): ${report.anomalies?.length || 0}`,
  ];

  pushSection(lines, '✅ ACTIVE SUPPORTERS', report.supported || [], supportLine);
  pushSection(lines, '❌ BELUM SUPPORT', report.unsupported || [], unsupportedLine);

  lines.push(
    '',
    'Daily Force: Sabtu–Khamis. Jumaat dikendalikan Friday Support System.',
    'Auto update bila user baru dikesan, Daily Force berubah atau payment berjaya.',
    'Manual check: /supportcheck <TelegramID>',
  );

  return lines.join('\n').slice(0, 3900);
}

async function currentDelivery() {
  await ensureSchema();
  const db = await getSupportDb();
  const result = await db.execute({
    sql: `SELECT group_id, message_id, content_hash, updated_at
          FROM support_monitor_message
          WHERE environment = ?
          LIMIT 1`,
    args: [currentSupportEnvironment()],
  });
  const row = result.rows?.[0];
  return row ? {
    groupId: String(row.group_id || ''),
    messageId: String(row.message_id || ''),
    contentHash: String(row.content_hash || ''),
    updatedAt: String(row.updated_at || ''),
  } : null;
}

async function saveDelivery(groupId, messageId, contentHash) {
  await ensureSchema();
  const db = await getSupportDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO support_monitor_message (
            environment, group_id, message_id, content_hash, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(environment) DO UPDATE SET
            group_id = excluded.group_id,
            message_id = excluded.message_id,
            content_hash = excluded.content_hash,
            updated_at = excluded.updated_at`,
    args: [
      currentSupportEnvironment(),
      String(groupId || ''),
      String(messageId || ''),
      String(contentHash || ''),
      now,
    ],
  });
}

export async function refreshSupportMonitorMessage({ force = false } = {}) {
  const target = await getPaymentDetailGroup();
  if (!target?.groupId) return { updated: false, reason: 'payment_detail_not_connected' };

  const report = await getSupportMonitorReport(80);
  const text = buildSupportMonitorMessage(report);
  const contentHash = createHash('sha256').update(text).digest('hex');
  const previous = await currentDelivery();

  if (
    !force
    && previous?.groupId === String(target.groupId)
    && previous?.contentHash === contentHash
  ) {
    return {
      updated: false,
      reason: 'unchanged',
      groupId: String(target.groupId),
      messageId: previous.messageId || null,
    };
  }

  if (
    previous?.groupId === String(target.groupId)
    && previous?.messageId
  ) {
    try {
      await telegram('editMessageText', {
        chat_id: target.groupId,
        message_id: Number(previous.messageId),
        text,
        disable_web_page_preview: true,
      });
      await saveDelivery(target.groupId, previous.messageId, contentHash);
      return {
        updated: true,
        mode: 'edited',
        groupId: String(target.groupId),
        messageId: previous.messageId,
      };
    } catch (error) {
      if (/message is not modified/i.test(String(error?.message || ''))) {
        await saveDelivery(target.groupId, previous.messageId, contentHash);
        return {
          updated: false,
          reason: 'telegram_not_modified',
          groupId: String(target.groupId),
          messageId: previous.messageId,
        };
      }
      console.warn('[support-monitor] edit auto message failed, creating a new one:', error?.message);
    }
  }

  const sent = await sendMessage(target.groupId, text);
  const messageId = String(sent?.message_id || '');
  await saveDelivery(target.groupId, messageId, contentHash);
  return {
    updated: true,
    mode: 'created',
    groupId: String(target.groupId),
    messageId: messageId || null,
  };
}
