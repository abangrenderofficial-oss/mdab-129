import { currentSupportEnvironment, getSupportDb } from './store.js';
import { getTelegramChat, sendMessage } from '../telegram.js';

let quoteSchemaPromise = null;

function cleanText(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

async function ensureQuoteFilterSchema() {
  if (!quoteSchemaPromise) {
    quoteSchemaPromise = (async () => {
      const db = await getSupportDb();
      await db.batch([
        `CREATE TABLE IF NOT EXISTS support_quote_filter_config (
          environment TEXT NOT NULL PRIMARY KEY,
          quote_group_id TEXT NOT NULL,
          quote_group_title TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS support_quote_moderation (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          environment TEXT NOT NULL,
          kind TEXT NOT NULL,
          body TEXT NOT NULL,
          display_name TEXT NOT NULL,
          tier_label TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'PENDING',
          filter_chat_id TEXT,
          filter_message_id TEXT,
          moderated_by TEXT,
          moderated_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_support_quote_moderation_status
          ON support_quote_moderation(environment, status, created_at)`,
      ], 'write');

      const moderationColumns = await db.execute('PRAGMA table_info(support_quote_moderation)');
      const moderationNames = new Set((moderationColumns.rows || []).map((row) => String(row.name || '')));
      if (!moderationNames.has('source_order_number')) {
        await db.execute("ALTER TABLE support_quote_moderation ADD COLUMN source_order_number TEXT NOT NULL DEFAULT ''");
      }
      if (!moderationNames.has('telegram_user_id')) {
        await db.execute("ALTER TABLE support_quote_moderation ADD COLUMN telegram_user_id TEXT NOT NULL DEFAULT ''");
      }
      return true;
    })().catch((error) => {
      quoteSchemaPromise = null;
      throw error;
    });
  }
  return quoteSchemaPromise;
}

export async function setQuoteFilterGroup(chatId, title = '') {
  const groupId = String(chatId || '').trim();
  if (!/^-?\d+$/.test(groupId)) throw new Error('Invalid quote filter group ID.');

  const chat = await getTelegramChat(groupId);
  if (!['group', 'supergroup'].includes(chat?.type)) {
    const error = new Error('Quote filter destination must be a Telegram group or supergroup.');
    error.code = 'QUOTE_FILTER_GROUP_REQUIRED';
    throw error;
  }

  await ensureQuoteFilterSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO support_quote_filter_config (
            environment, quote_group_id, quote_group_title, updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(environment) DO UPDATE SET
            quote_group_id = excluded.quote_group_id,
            quote_group_title = excluded.quote_group_title,
            updated_at = excluded.updated_at`,
    args: [environment, groupId, cleanText(title, 160), now],
  });

  return { groupId, title: cleanText(title, 160), updatedAt: now };
}

export async function getQuoteFilterGroup() {
  await ensureQuoteFilterSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT quote_group_id, quote_group_title, updated_at
          FROM support_quote_filter_config
          WHERE environment = ?
          LIMIT 1`,
    args: [environment],
  });
  const row = result.rows?.[0];
  if (!row?.quote_group_id) return null;
  return {
    groupId: String(row.quote_group_id),
    title: String(row.quote_group_title || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function rowToModeration(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    kind: String(row.kind || ''),
    body: String(row.body || ''),
    displayName: String(row.display_name || ''),
    tierLabel: String(row.tier_label || ''),
    sourceOrderNumber: String(row.source_order_number || ''),
    telegramUserId: String(row.telegram_user_id || ''),
    status: String(row.status || ''),
    filterChatId: row.filter_chat_id ? String(row.filter_chat_id) : '',
    filterMessageId: row.filter_message_id ? String(row.filter_message_id) : '',
    moderatedBy: row.moderated_by ? String(row.moderated_by) : '',
    moderatedAt: row.moderated_at ? String(row.moderated_at) : '',
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

async function createModeration({
  kind,
  body,
  displayName,
  tierLabel = '',
  sourceOrderNumber = '',
  telegramUserId = '',
}) {
  await ensureQuoteFilterSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `INSERT INTO support_quote_moderation (
            environment, kind, body, display_name, tier_label,
            source_order_number, telegram_user_id,
            status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    args: [
      environment,
      cleanText(kind, 32),
      cleanText(body, 1800),
      cleanText(displayName, 80),
      cleanText(tierLabel, 100),
      cleanText(sourceOrderNumber, 160),
      cleanText(telegramUserId, 40),
      now,
      now,
    ],
  });
  const id = Number(result?.lastInsertRowid || 0);
  if (!id) throw new Error('Failed to create quote moderation record.');
  return id;
}

async function attachFilterMessage(id, chatId, messageId) {
  await ensureQuoteFilterSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE support_quote_moderation
          SET filter_chat_id = ?, filter_message_id = ?, updated_at = ?
          WHERE environment = ? AND id = ?`,
    args: [String(chatId || ''), String(messageId || ''), now, environment, Number(id)],
  });
}

export async function getQuoteModeration(id) {
  const moderationId = Number(id || 0);
  if (!Number.isSafeInteger(moderationId) || moderationId <= 0) return null;
  await ensureQuoteFilterSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const result = await db.execute({
    sql: `SELECT id, kind, body, display_name, tier_label,
                 source_order_number, telegram_user_id, status,
                 filter_chat_id, filter_message_id, moderated_by,
                 moderated_at, created_at, updated_at
          FROM support_quote_moderation
          WHERE environment = ? AND id = ?
          LIMIT 1`,
    args: [environment, moderationId],
  });
  return rowToModeration(result.rows?.[0] || null);
}

export async function moderateQuote(id, decision, moderatorUserId) {
  const moderationId = Number(id || 0);
  const status = String(decision || '').toUpperCase();
  if (!Number.isSafeInteger(moderationId) || moderationId <= 0) return null;
  if (!['APPROVED', 'REJECTED'].includes(status)) return null;

  await ensureQuoteFilterSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();

  await db.execute({
    sql: `UPDATE support_quote_moderation
          SET status = ?, moderated_by = ?, moderated_at = ?, updated_at = ?
          WHERE environment = ? AND id = ? AND status = 'PENDING'`,
    args: [status, String(moderatorUserId || ''), now, now, environment, moderationId],
  });

  return getQuoteModeration(moderationId);
}

function moderationKeyboard(id) {
  return {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `quote:approve:${id}` },
      { text: '❌ Reject', callback_data: `quote:reject:${id}` },
    ]],
  };
}

async function requireConnectedFilterGroup(groupId) {
  const chat = await getTelegramChat(groupId);
  if (!['group', 'supergroup'].includes(chat?.type)) {
    const error = new Error('Connected quote destination is not a Telegram group.');
    error.code = 'QUOTE_FILTER_DESTINATION_INVALID';
    throw error;
  }
  if (String(chat.id || '') !== String(groupId || '')) {
    const error = new Error('Connected quote destination no longer matches the saved group.');
    error.code = 'QUOTE_FILTER_DESTINATION_MISMATCH';
    throw error;
  }
  return chat;
}

async function sendToQuoteFilter({
  kind,
  text,
  body,
  displayName,
  tierLabel = '',
  sourceOrderNumber = '',
  telegramUserId = '',
}) {
  const target = await getQuoteFilterGroup();
  if (!target?.groupId) {
    const error = new Error('Quote filter group is not connected.');
    error.code = 'QUOTE_FILTER_NOT_CONNECTED';
    throw error;
  }

  await requireConnectedFilterGroup(target.groupId);
  const moderationId = await createModeration({
    kind,
    body,
    displayName,
    tierLabel,
    sourceOrderNumber,
    telegramUserId,
  });
  try {
    const sent = await sendMessage(target.groupId, text, {
      reply_markup: moderationKeyboard(moderationId),
    });
    await attachFilterMessage(moderationId, target.groupId, sent?.message_id || '');
    return { ...target, moderationId, messageId: sent?.message_id || null };
  } catch (error) {
    const db = await getSupportDb().catch(() => null);
    if (db) {
      const now = new Date().toISOString();
      await db.execute({
        sql: `UPDATE support_quote_moderation
              SET status = 'SEND_FAILED', updated_at = ?
              WHERE environment = ? AND id = ? AND status = 'PENDING'`,
        args: [now, currentSupportEnvironment(), moderationId],
      }).catch(() => {});
    }
    throw error;
  }
}

export async function sendSupportQuoteToFilter({
  supportMessage,
  displayName,
  tierLabel,
  orderNumber = '',
  userId = '',
}) {
  const message = cleanText(supportMessage, 500);
  const name = cleanText(displayName, 80);
  const tier = cleanText(tierLabel, 100) || '❤️ Supporter';
  if (!message || !name) throw new Error('Support quote is incomplete.');

  return sendToQuoteFilter({
    kind: 'SUPPORT',
    body: message,
    displayName: name,
    tierLabel: tier,
    sourceOrderNumber: cleanText(orderNumber, 160),
    telegramUserId: cleanText(userId, 40),
    text: [
      `“${message}”`,
      '',
      `${name}, ${tier}`,
    ].join('\n'),
  });
}

export async function sendLuahRasaToFilter({ message, displayName, tierLabel = '' }) {
  const luahan = cleanText(message, 1500);
  const name = cleanText(displayName, 80);
  const tier = cleanText(tierLabel, 100);
  if (!luahan || !name) throw new Error('Luah rasa submission is incomplete.');

  return sendToQuoteFilter({
    kind: 'LUAHRASA',
    body: luahan,
    displayName: name,
    tierLabel: tier,
    text: [
      '💭 Luah Rasa',
      '',
      `“${luahan}”`,
      '',
      tier ? `${name}, ${tier}` : name,
    ].join('\n'),
  });
}
