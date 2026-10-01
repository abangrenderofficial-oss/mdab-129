import { currentSupportEnvironment, getSupportDb } from './store.js';
import { sendMessage } from '../telegram.js';

let quoteSchemaPromise = null;

function cleanText(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

async function ensureQuoteFilterSchema() {
  if (!quoteSchemaPromise) {
    quoteSchemaPromise = (async () => {
      const db = await getSupportDb();
      await db.execute(`CREATE TABLE IF NOT EXISTS support_quote_filter_config (
        environment TEXT NOT NULL PRIMARY KEY,
        quote_group_id TEXT NOT NULL,
        quote_group_title TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`);
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

async function sendToQuoteFilter(text) {
  const target = await getQuoteFilterGroup();
  if (!target?.groupId) {
    const error = new Error('Quote filter group is not connected.');
    error.code = 'QUOTE_FILTER_NOT_CONNECTED';
    throw error;
  }
  await sendMessage(target.groupId, text);
  return target;
}

export async function sendSupportQuoteToFilter({ supportMessage, displayName, tierLabel }) {
  const message = cleanText(supportMessage, 500);
  const name = cleanText(displayName, 80);
  const tier = cleanText(tierLabel, 100) || '❤️ Supporter';
  if (!message || !name) throw new Error('Support quote is incomplete.');

  return sendToQuoteFilter([
    `“${message}”`,
    '',
    `${name}, ${tier}`,
  ].join('\n'));
}

export async function sendLuahRasaToFilter({ message, displayName, tierLabel = '' }) {
  const luahan = cleanText(message, 1500);
  const name = cleanText(displayName, 80);
  const tier = cleanText(tierLabel, 100);
  if (!luahan || !name) throw new Error('Luah rasa submission is incomplete.');

  return sendToQuoteFilter([
    '💭 Luah Rasa',
    '',
    `“${luahan}”`,
    '',
    tier ? `${name}, ${tier}` : name,
  ].join('\n'));
}
