import { currentSupportEnvironment, getSupportDb } from '../support/store.js';

let schemaPromise = null;

function clean(value, max = 300) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS downloader_channel_policy_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          environment TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          message_id TEXT,
          method TEXT NOT NULL,
          purpose TEXT NOT NULL,
          status TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        )`,
        `CREATE INDEX IF NOT EXISTS idx_downloader_channel_policy_reset
          ON downloader_channel_policy_log(environment, chat_id, status, purpose, id)`,
      ], 'write');
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function prepareChannelPolicyLedger() {
  await ensureSchema();
  return true;
}

export async function recordChannelPolicyEvent({
  chatId,
  messageId = '',
  method,
  purpose,
  status,
  detail = '',
}) {
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO downloader_channel_policy_log (
            environment, chat_id, message_id, method, purpose,
            status, detail, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      environment,
      String(chatId || ''),
      messageId ? String(messageId) : null,
      clean(method, 80),
      clean(purpose, 80),
      clean(status, 40),
      clean(detail, 500),
      now,
      now,
    ],
  });
}

export async function listResettableChannelMessages(chatIds = []) {
  await ensureSchema();
  const ids = [...new Set((chatIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) return [];
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.execute({
    sql: `SELECT id, chat_id, message_id, method, purpose, status, detail, created_at
          FROM downloader_channel_policy_log
          WHERE environment = ?
            AND chat_id IN (${placeholders})
            AND message_id IS NOT NULL
            AND status = 'SENT'
            AND purpose <> 'SUPPORT_PROMOTION'
          ORDER BY id ASC`,
    args: [environment, ...ids],
  });
  return (result.rows || []).map((row) => ({
    id: Number(row.id || 0),
    chatId: String(row.chat_id || ''),
    messageId: String(row.message_id || ''),
    method: String(row.method || ''),
    purpose: String(row.purpose || ''),
    detail: String(row.detail || ''),
    createdAt: String(row.created_at || ''),
  }));
}

export async function markChannelPolicyDeleted(id) {
  const rowId = Number(id || 0);
  if (!Number.isSafeInteger(rowId) || rowId <= 0) return false;
  await ensureSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `UPDATE downloader_channel_policy_log
          SET status = 'DELETED', deleted_at = ?, updated_at = ?
          WHERE environment = ? AND id = ? AND status = 'SENT'`,
    args: [now, now, environment, rowId],
  });
  return Number(result.rowsAffected || 0) > 0;
}

export async function listQuoteFilterLeakMessages(channelIds = []) {
  await ensureSchema();
  const ids = [...new Set((channelIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) return [];
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.execute({
    sql: `SELECT id, kind, filter_chat_id, filter_message_id, status, created_at
          FROM support_quote_moderation
          WHERE environment = ?
            AND filter_chat_id IN (${placeholders})
            AND filter_message_id IS NOT NULL
          ORDER BY id ASC`,
    args: [environment, ...ids],
  }).catch(() => ({ rows: [] }));
  return (result.rows || []).map((row) => ({
    moderationId: Number(row.id || 0),
    kind: String(row.kind || ''),
    chatId: String(row.filter_chat_id || ''),
    messageId: String(row.filter_message_id || ''),
    status: String(row.status || ''),
    createdAt: String(row.created_at || ''),
  }));
}
