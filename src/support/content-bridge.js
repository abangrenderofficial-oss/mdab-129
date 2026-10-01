import { currentSupportEnvironment, getSupportDb } from './store.js';

let schemaPromise = null;

function cleanText(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function contentManagerUrl() {
  return String(
    process.env.CONTENT_MANAGER_URL || 'https://abangrender-content-manager.onrender.com',
  ).trim().replace(/\/$/, '');
}

function bridgeSecret() {
  return String(process.env.CONTENT_BRIDGE_SECRET || '').trim();
}

export function isContentBridgeConfigured() {
  return Boolean(contentManagerUrl() && bridgeSecret());
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS support_quote_content_bridge_config (
          environment TEXT NOT NULL PRIMARY KEY,
          filter_group_id TEXT NOT NULL,
          filter_group_title TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS support_quote_content_delivery (
          environment TEXT NOT NULL,
          moderation_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          attempts INTEGER NOT NULL DEFAULT 0,
          channel_message_id TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (environment, moderation_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_support_quote_content_delivery_status
          ON support_quote_content_delivery(environment, status, updated_at)`,
      ], 'write');
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function setContentBridgeGroup(chatId, title = '') {
  const groupId = String(chatId || '').trim();
  if (!/^-?\d+$/.test(groupId)) throw new Error('Invalid content filter group ID.');

  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO support_quote_content_bridge_config (
            environment, filter_group_id, filter_group_title, updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(environment) DO UPDATE SET
            filter_group_id = excluded.filter_group_id,
            filter_group_title = excluded.filter_group_title,
            updated_at = excluded.updated_at`,
    args: [environment, groupId, cleanText(title, 160), now],
  });
  return { groupId, title: cleanText(title, 160), updatedAt: now };
}

export async function getContentBridgeGroup() {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT filter_group_id, filter_group_title, updated_at
          FROM support_quote_content_bridge_config
          WHERE environment = ?
          LIMIT 1`,
    args: [environment],
  });
  const row = result.rows?.[0];
  if (!row?.filter_group_id) return null;
  return {
    groupId: String(row.filter_group_id),
    title: String(row.filter_group_title || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function rowToApproved(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    kind: String(row.kind || ''),
    body: String(row.body || ''),
    displayName: String(row.display_name || ''),
    tierLabel: String(row.tier_label || ''),
    status: String(row.status || ''),
    filterChatId: row.filter_chat_id ? String(row.filter_chat_id) : '',
    filterMessageId: row.filter_message_id ? String(row.filter_message_id) : '',
  };
}

async function getApprovedModeration(id) {
  const moderationId = Number(id || 0);
  if (!Number.isSafeInteger(moderationId) || moderationId <= 0) return null;
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT id, kind, body, display_name, tier_label, status,
                 filter_chat_id, filter_message_id
          FROM support_quote_moderation
          WHERE environment = ? AND id = ? AND status = 'APPROVED'
          LIMIT 1`,
    args: [environment, moderationId],
  });
  return rowToApproved(result.rows?.[0] || null);
}

async function claimDelivery(moderationId) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date();
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

  await db.execute({
    sql: `INSERT OR IGNORE INTO support_quote_content_delivery (
            environment, moderation_id, status, attempts, created_at, updated_at
          ) VALUES (?, ?, 'PENDING', 0, ?, ?)`,
    args: [environment, Number(moderationId), nowIso, nowIso],
  });

  const claimed = await db.execute({
    sql: `UPDATE support_quote_content_delivery
          SET status = 'SENDING', attempts = attempts + 1,
              last_error = NULL, updated_at = ?
          WHERE environment = ? AND moderation_id = ?
            AND (
              status IN ('PENDING', 'FAILED')
              OR (status = 'SENDING' AND updated_at < ?)
            )`,
    args: [nowIso, environment, Number(moderationId), staleIso],
  });
  return Number(claimed.rowsAffected || 0) > 0;
}

async function markDelivery(moderationId, status, { channelMessageId = '', error = '' } = {}) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE support_quote_content_delivery
          SET status = ?, channel_message_id = ?, last_error = ?, updated_at = ?
          WHERE environment = ? AND moderation_id = ?`,
    args: [
      status,
      channelMessageId ? String(channelMessageId) : null,
      error ? cleanText(error, 500) : null,
      now,
      environment,
      Number(moderationId),
    ],
  });
}

export async function deliverApprovedModeration(input) {
  if (!isContentBridgeConfigured()) {
    return { delivered: false, reason: 'bridge_not_configured' };
  }

  const record = input?.id ? input : await getApprovedModeration(input);
  if (!record || String(record.status || '') !== 'APPROVED') {
    return { delivered: false, reason: 'not_approved' };
  }

  const target = await getContentBridgeGroup();
  if (!target?.groupId || String(record.filterChatId || '') !== String(target.groupId)) {
    return { delivered: false, reason: 'group_not_connected' };
  }

  if (!(await claimDelivery(record.id))) {
    return { delivered: false, reason: 'already_claimed_or_sent' };
  }

  try {
    const response = await fetch(`${contentManagerUrl()}/integrations/content/approved`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-content-bridge-secret': bridgeSecret(),
      },
      body: JSON.stringify({
        moderation_id: record.id,
        filter_chat_id: record.filterChatId,
        filter_message_id: record.filterMessageId,
        kind: record.kind,
        body: record.body,
        display_name: record.displayName,
        tier_label: record.tierLabel,
      }),
      signal: AbortSignal.timeout(60000),
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {}

    if (!response.ok || payload?.ok !== true) {
      throw new Error(`content_manager_http_${response.status}:${payload?.detail || payload?.error || 'unknown'}`);
    }

    await markDelivery(record.id, 'SENT', {
      channelMessageId: payload?.channel_message_id || '',
    });
    console.info('[content-bridge] delivered', {
      moderationId: record.id,
      kind: record.kind,
      filterGroupId: record.filterChatId,
      channelMessageId: payload?.channel_message_id || null,
    });
    return {
      delivered: true,
      moderationId: record.id,
      channelMessageId: payload?.channel_message_id || null,
    };
  } catch (error) {
    await markDelivery(record.id, 'FAILED', { error: error?.message || String(error) }).catch(() => {});
    console.error('[content-bridge] delivery failed', {
      moderationId: record.id,
      error: error?.message || String(error),
    });
    return { delivered: false, reason: 'delivery_failed', error: error?.message || String(error) };
  }
}

export async function deliverApprovedBacklog(limit = 50) {
  if (!isContentBridgeConfigured()) return { checked: 0, delivered: 0 };
  const target = await getContentBridgeGroup();
  if (!target?.groupId) return { checked: 0, delivered: 0 };

  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT m.id, m.kind, m.body, m.display_name, m.tier_label,
                 m.status, m.filter_chat_id, m.filter_message_id
          FROM support_quote_moderation m
          LEFT JOIN support_quote_content_delivery d
            ON d.environment = m.environment AND d.moderation_id = m.id
          WHERE m.environment = ?
            AND m.status = 'APPROVED'
            AND m.filter_chat_id = ?
            AND COALESCE(d.status, 'PENDING') <> 'SENT'
          ORDER BY m.id ASC
          LIMIT ?`,
    args: [environment, String(target.groupId), Math.max(1, Math.min(200, Number(limit) || 50))],
  });

  let delivered = 0;
  const rows = result.rows || [];
  for (const row of rows) {
    const output = await deliverApprovedModeration(rowToApproved(row));
    if (output.delivered) delivered += 1;
  }
  return { checked: rows.length, delivered };
}
