// Private, owner-controlled record of /luahrasa and supporter testimonials.
// The public /connectquote filter and channel bridge never import this module.
import { currentSupportEnvironment, getSupportDb } from './store.js';
import { getTelegramChat, sendMessage } from '../telegram.js';
import { getActiveSupporterTitle } from './community-store.js';

let schemaPromise = null;
const RETRY_STALE_MINUTES = 12;

function clean(value, limit = 180) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);
}

function validId(value) {
  const id = String(value ?? '').trim();
  return /^\d{1,20}$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? id : '';
}

async function schema() {
  if (!schemaPromise) schemaPromise = (async () => {
    const db = await getSupportDb();
    await db.batch([
      `CREATE TABLE IF NOT EXISTS support_quote_admin_config (
        environment TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS support_quote_admin_entries (
        environment TEXT NOT NULL,
        moderation_id INTEGER NOT NULL,
        telegram_user_id TEXT NOT NULL DEFAULT '',
        telegram_username TEXT NOT NULL DEFAULT '',
        telegram_name TEXT NOT NULL DEFAULT '',
        supporter_status TEXT NOT NULL DEFAULT 'UNKNOWN',
        supporter_tier TEXT NOT NULL DEFAULT '',
        delivery_status TEXT NOT NULL DEFAULT 'PENDING',
        claimed_at TEXT,
        delivered_at TEXT,
        admin_message_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (environment, moderation_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_support_quote_admin_pending
        ON support_quote_admin_entries(environment, delivery_status, created_at)`,
    ], 'write');
    return true;
  })().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}

async function quoteFilterGroupId(db, environment) {
  try {
    const result = await db.execute({
      sql: 'SELECT quote_group_id FROM support_quote_filter_config WHERE environment=? LIMIT 1',
      args: [environment],
    });
    return String(result.rows?.[0]?.quote_group_id || '');
  } catch (error) {
    if (String(error?.message || '').includes('no such table')) return '';
    throw error;
  }
}

export async function getQuoteAdminGroup() {
  await schema();
  const db = await getSupportDb();
  const res = await db.execute({
    sql: 'SELECT group_id, title FROM support_quote_admin_config WHERE environment=? LIMIT 1',
    args: [currentSupportEnvironment()],
  });
  const row = res.rows?.[0];
  return row?.group_id ? { groupId: String(row.group_id), title: String(row.title || '') } : null;
}

export async function setQuoteAdminGroup(chatId, title = '') {
  const groupId = String(chatId || '').trim();
  if (!/^-\d{5,20}$/.test(groupId)) throw new Error('Invalid private group ID');
  const group = await getTelegramChat(groupId);
  if (!['group','supergroup'].includes(String(group?.type)) || String(group?.id) !== groupId)
    throw new Error('Quote admin destination must be the exact Telegram group');
  if (group.username) throw new Error('Use a private group without a public @username for user data.');
  await schema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  if (groupId === await quoteFilterGroupId(db, environment))
    throw new Error('Admin group must be separate from the public Quote Filter group');
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO support_quote_admin_config(environment,group_id,title,updated_at)
      VALUES (?,?,?,?) ON CONFLICT(environment) DO UPDATE SET
      group_id=excluded.group_id,title=excluded.title,updated_at=excluded.updated_at`,
    args: [environment, groupId, clean(title, 160), now],
  });
  return { groupId, title: clean(title, 160) };
}

export async function disconnectQuoteAdminGroup(chatId) {
  await schema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const group = await getQuoteAdminGroup();
  if (!group || String(group.groupId) !== String(chatId)) return false;
  await db.execute({sql: 'DELETE FROM support_quote_admin_config WHERE environment=? AND group_id=?',
    args: [environment, group.groupId]});
  return true;
}

async function activeSupportStatus(telegramUserId) {
  if (!telegramUserId) return { status: 'UNKNOWN', tier: '' };
  try {
    const title = await getActiveSupporterTitle(telegramUserId);
    return title
      ? { status: 'SUPPORTED', tier: clean(title.tierLabel, 100) }
      : { status: 'NOT_SUPPORTED', tier: '' };
  } catch (error) {
    console.warn('[quote-admin] supporter status lookup failed:', error?.message);
    return { status: 'UNKNOWN', tier: '' };
  }
}

export function formatQuoteAdminMessage(row) {
  const kind = String(row.kind || '') === 'LUAHRASA'
    ? '💭 LUAH RASA'
    : '❤️ SUPPORT MESSAGE';
  const supported = row.supporter_status === 'SUPPORTED'
    ? `✅ Supported${row.supporter_tier ? ` — ${row.supporter_tier}` : ''}`
    : row.supporter_status === 'NOT_SUPPORTED'
      ? '❌ Not supported'
      : '⚪ Unknown (cannot verify)';
  return [
    '🔒 MediaX — Private Quote Database',
    `Submission #${row.moderation_id} | ${kind}`,
    '',
    'Message:',
    `“${String(row.body || '').slice(0, 1800)}”`,
    '',
    `Submitted name: ${row.display_name || '—'}`,
    `Telegram name: ${row.telegram_name || '—'}`,
    `Username: ${row.telegram_username ? '@' + row.telegram_username : 'Not set'}`,
    `Telegram ID: ${row.telegram_user_id || 'Unavailable'}`,
    `Supporter status: ${supported}`,
    `Filter status: ${row.status || 'PENDING'}`,
    '',
    '🔐 Admin-only record. Do not share IDs or personal details publicly.',
  ].join('\n').slice(0, 3900);
}

async function readPending(db, env, moderationId = 0, limit = 8) {
  const args = [env];
  let extra = '';
  if (moderationId) {
    extra = ' AND a.moderation_id=?';
    args.push(moderationId);
  }
  args.push(Math.min(20, Math.max(1, limit)));
  const result = await db.execute({
    sql: `SELECT a.*, m.body, m.kind, m.display_name, m.status
      FROM support_quote_admin_entries a
      JOIN support_quote_moderation m
        ON m.environment=a.environment AND m.id=a.moderation_id
      WHERE a.environment=?${extra}
        AND (a.delivery_status='PENDING'
          OR (a.delivery_status='SENDING'
              AND datetime(a.claimed_at) < datetime('now','-${RETRY_STALE_MINUTES} minutes')))
      ORDER BY a.created_at ASC LIMIT ?`,
    args,
  });
  return result.rows || [];
}

// Store first, then send. A temporary Telegram error leaves the audit in
// PENDING for retry when the group reconnects or another quote is submitted.
export async function recordQuoteAdminSubmission(moderationId, { userId = '', actor = {} } = {}) {
  const uid = validId(userId || actor?.id);
  const username = clean(String(actor?.username || '').replace(/^@/, ''), 90);
  const realName = clean([actor?.first_name,actor?.last_name].filter(Boolean).join(' '), 170);
  const paid = await activeSupportStatus(uid);
  await schema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  await db.execute({
    sql: `INSERT INTO support_quote_admin_entries (
        environment,moderation_id,telegram_user_id,telegram_username,telegram_name,
        supporter_status,supporter_tier,delivery_status,created_at
      ) VALUES(?,?,?,?,?,?,?,'PENDING',?)
      ON CONFLICT(environment,moderation_id) DO NOTHING`,
    args: [environment, Number(moderationId), uid, username, realName,
      paid.status, paid.tier, new Date().toISOString()],
  });
  await deliverPendingQuoteAdminSubmissions({ moderationId: Number(moderationId), limit: 1 });
}

export async function deliverPendingQuoteAdminSubmissions({ moderationId = 0, limit = 8 } = {}) {
  const group = await getQuoteAdminGroup();
  if (!group) return { configured: false, delivered: 0 };
  const db = await getSupportDb();
  const env = currentSupportEnvironment();
  if (group.groupId === await quoteFilterGroupId(db, env)) {
    console.error('[quote-admin] refused delivery to filter destination');
    return { configured: false, delivered: 0 };
  }
  const target = await getTelegramChat(group.groupId);
  if (!['group','supergroup'].includes(target?.type) || target?.username
      || String(target?.id) !== group.groupId) {
    console.error('[quote-admin] destination is not a verified private group');
    return { configured: false, delivered: 0 };
  }
  const rows = await readPending(db, env, moderationId, limit);
  let delivered = 0;
  for (const row of rows) {
    const now = new Date().toISOString();
    const claim = await db.execute({
      sql: `UPDATE support_quote_admin_entries SET delivery_status='SENDING', claimed_at=?
        WHERE environment=? AND moderation_id=?
        AND (delivery_status='PENDING' OR
          (delivery_status='SENDING' AND datetime(claimed_at) < datetime('now','-${RETRY_STALE_MINUTES} minutes')))`,
      args: [now, env, Number(row.moderation_id)],
    });
    if (Number(claim.rowsAffected || 0) !== 1) continue;
    try {
      const message = await sendMessage(group.groupId, formatQuoteAdminMessage(row));
      await db.execute({
        sql: `UPDATE support_quote_admin_entries
          SET delivery_status='SENT',delivered_at=?,admin_message_id=?
          WHERE environment=? AND moderation_id=?`,
        args: [new Date().toISOString(), String(message?.message_id || ''), env, Number(row.moderation_id)],
      });
      delivered++;
    } catch (error) {
      await db.execute({
        sql: `UPDATE support_quote_admin_entries
          SET delivery_status='PENDING',claimed_at=NULL
          WHERE environment=? AND moderation_id=? AND delivery_status='SENDING'`,
        args: [env, Number(row.moderation_id)],
      }).catch(() => {});
      console.warn('[quote-admin] private record send failed; retry retained:', error?.message);
    }
  }
  return { configured: true, delivered };
}
