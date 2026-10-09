import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  authenticateHeavyHqCompletion, signHeavyHqCompletion,
} from '../src/support/heavy-hq-callback-auth.js';

// All statistics written below live only in a temporary runner directory.
// We never use Render /data, Railway volumes, production Turso or a real bot.
const dir = await mkdtemp(path.join(tmpdir(), 'mediax-render-hq-callback-'));
const file = path.join(dir, 'isolated-stats.json');
process.env.STATS_FILE_PATH = file;
process.env.MEDIAX_STATS_BACKEND = 'file';
const token = 'FAKE_OFFLINE_KEY_ONLY';
try {
  const body = {
    chat_id: '-1009876543210',
    user_id: '123456',
    event: 'status_hq',
    completion_key: 'heavy:-1009876543210:123456:456:file-1',
  };
  const signature = signHeavyHqCompletion(token, {
    chatId: Number(body.chat_id), userId: Number(body.user_id),
    completionKey: body.completion_key,
  });
  const signed = authenticateHeavyHqCompletion({method:'POST',token,body,signature});
  assert.equal(signed.ok, true);
  assert.equal(signed.chatId, -1009876543210);
  assert.equal(signed.userId, 123456);
  assert.equal(signed.completionKey, body.completion_key);
  assert.deepEqual(authenticateHeavyHqCompletion({
    method:'GET',token,body,signature,
  }).status,405);
  assert.deepEqual(authenticateHeavyHqCompletion({
    method:'POST',token,body:{...body,user_id:'123457'},signature,
  }).status,401,'tampered user id must fail');
  assert.deepEqual(authenticateHeavyHqCompletion({
    method:'POST',token,body:{...body,completion_key:body.completion_key+'x'},signature,
  }).status,401,'tampered completion key must fail');
  assert.deepEqual(authenticateHeavyHqCompletion({
    method:'POST',token,body,signature:'aaaa',
  }).status,401);
  assert.deepEqual(authenticateHeavyHqCompletion({
    method:'POST',token,body:{...body,chat_id:'0'},signature,
  }).status,400);
  assert.deepEqual(authenticateHeavyHqCompletion({
    method:'POST',token:'',body,signature,
  }).status,503);
  const stats = await import('../src/bot/stats.js');
  const first = await stats.markPremiumHqCompleted(body.user_id, body.completion_key, {
    recordCompletionUse:true,
  });
  const duplicate = await stats.markPremiumHqCompleted(body.user_id, body.completion_key, {
    recordCompletionUse:true,
  });
  assert.equal(first,true);
  assert.equal(duplicate,false);
  assert.equal(await stats.getPremiumHqCompletedCount(body.user_id),1);
  const saved = JSON.parse(await readFile(file,'utf8'));
  const user = saved.users[body.user_id];
  assert.equal(user.completedUse,true);
  assert.equal(user.statusHq,true);
  assert.equal(user.premiumHqCompletedCount,1);
  assert.equal(user.channelUseCount,1);
  assert.deepEqual(user.premiumHqCompletionKeys,[body.completion_key]);
  const secondKey = 'heavy:-1009876543210:123456:457:file-2';
  assert.equal(await stats.markPremiumHqCompleted(body.user_id,secondKey,{
    recordCompletionUse:true,
  }),true);
  assert.equal(await stats.getPremiumHqCompletedCount(body.user_id),2);
  console.log('RENDER_HQ_CALLBACK_SELFTEST_OK — signed group/private callback tamper checks and exactly-once counter/usage in isolated file');
} finally {
  await rm(dir,{recursive:true,force:true});
}
