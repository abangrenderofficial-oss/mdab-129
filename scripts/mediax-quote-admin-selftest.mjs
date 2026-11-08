// End-to-end dual quote delivery test with an isolated SQLite database.
// Never posts test quotes to production Telegram groups.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(tmpdir(), 'mediax-quote-admin-test-'));
Object.assign(process.env, {
  TURSO_DATABASE_URL: 'file:' + path.join(dir, 'quotes.db'),
  TURSO_AUTH_TOKEN: 'local-selftest',
  BAYARCASH_SANDBOX: 'true',
  TELEGRAM_BOT_TOKEN: '123456789:quote_admin_test',
  BOT_OWNER_ID: '999999999',
});
const events = [];
const publicChat = '-1001010101010';
const adminChat = '-1002020202020';
let messageId = 700;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const method = String(url).split('/').pop();
  const data = JSON.parse(options.body || '{}');
  const result = method === 'getChat' ? {
    id: String(data.chat_id), type: 'supergroup', title: 'Private test group',
  } : method === 'getChatMember' ? {
    status: 'administrator',
  } : { message_id: ++messageId };
  events.push({ method, data, result });
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};

try {
  const filter = await import('../src/support/quote-filter.js');
  const admin = await import('../src/support/quote-admin.js');
  const actor = { id: 123450001, username: 'sample_user_123', first_name: 'Sample', last_name: 'Member' };
  await filter.setQuoteFilterGroup(publicChat, 'Filter');
  await assert.rejects(admin.setQuoteAdminGroup(publicChat, 'Same Group'), /separate/);
  await admin.setQuoteAdminGroup(adminChat, 'Private Database');
  await assert.rejects(filter.setQuoteFilterGroup(adminChat, 'Same Group'), /separate/);

  const quote = 'Macam mana nak jadi lebih kuat bila hidup memang rasa terlalu susah sekarang';
  await filter.sendLuahRasaToFilter({
    message: quote, displayName: 'Fatin', userId: actor.id, telegramActor: actor,
  });
  let publicMessages = events.filter(e => e.method === 'sendMessage' && String(e.data.chat_id) === publicChat);
  let adminMessages = events.filter(e => e.method === 'sendMessage' && String(e.data.chat_id) === adminChat);
  assert.equal(publicMessages.length, 1);
  assert.equal(adminMessages.length, 1);
  assert.equal(publicMessages[0].data.text, '💭 Luah Rasa\n\n“' + quote + '”\n\nFatin');
  assert.match(publicMessages[0].data.reply_markup.inline_keyboard[0][0].text, /Approve/);
  assert.ok(!publicMessages[0].data.text.includes(String(actor.id)), 'No identity in filter text');
  assert.ok(!publicMessages[0].data.text.includes(actor.username), 'No username in filter text');
  assert.match(adminMessages[0].data.text, /Telegram ID: 123450001/);
  assert.match(adminMessages[0].data.text, /Username: @sample_user_123/);
  assert.match(adminMessages[0].data.text, /Telegram name: Sample Member/);
  assert.match(adminMessages[0].data.text, /Submitted name: Fatin/);
  assert.match(adminMessages[0].data.text, /Not supported/);

  const firstSupport = 'This bot has helped me with my daily downloads and content work';
  await filter.sendSupportQuoteToFilter({
    supportMessage: firstSupport, displayName: 'Anonymous', tierLabel: '🤍 Supporter',
    orderNumber: 'TEST-NOT-REAL', userId: actor.id, telegramActor: actor,
  });
  publicMessages = events.filter(e => e.method === 'sendMessage' && String(e.data.chat_id) === publicChat);
  adminMessages = events.filter(e => e.method === 'sendMessage' && String(e.data.chat_id) === adminChat);
  assert.equal(publicMessages.length, 2);
  assert.equal(adminMessages.length, 2);
  assert.equal(publicMessages[1].data.text,
    'Kata Support Buat Team MediaX👏🏻\n\nAnonymous\n\n“' + firstSupport + '”\n\nFrom 🤍 Supporter');
  assert.ok(!publicMessages[1].data.text.includes(actor.username));
  assert.match(adminMessages[1].data.text, /SUPPORT MESSAGE/);
  assert.match(adminMessages[1].data.text, /Submitted name: Anonymous/);
  assert.match(adminMessages[1].data.text, /Telegram ID: 123450001/);

  assert.equal(await admin.disconnectQuoteAdminGroup(adminChat), true);
  await filter.sendLuahRasaToFilter({
    message: 'Here is another private journal entry for a different day in life',
    displayName: 'Sarah', userId: actor.id, telegramActor: actor,
  });
  assert.equal(events.filter(e => e.method === 'sendMessage' && String(e.data.chat_id) === adminChat).length, 2,
    'Admin must not receive more messages after disconnect');
  await admin.setQuoteAdminGroup(adminChat, 'Private Database');
  const replay = await admin.deliverPendingQuoteAdminSubmissions({ limit: 15 });
  assert.equal(replay.delivered, 1, 'Undelivered private record should be sent on reconnect');
  assert.equal((await admin.deliverPendingQuoteAdminSubmissions({ limit: 15 })).delivered, 0,
    'Already sent quote must not be sent twice');

  const db = await (await import('../src/support/store.js')).getSupportDb();
  const entries = await db.execute("SELECT delivery_status, telegram_user_id, telegram_username, telegram_name FROM support_quote_admin_entries ORDER BY moderation_id");
  assert.equal(entries.rows.length, 3);
  assert.ok(entries.rows.every(row => row.delivery_status === 'SENT'));
  assert.ok(entries.rows.every(row => row.telegram_user_id === String(actor.id)));
  console.log('MEDIAX_QUOTE_ADMIN_DUAL_GROUP_TEST_OK — Luah Rasa and support quotes to separate groups, filter format unchanged, personal ID only private, pending retry, disconnect, conflict protection');
} finally {
  globalThis.fetch = originalFetch;
  await rm(dir, { recursive: true, force: true });
}
