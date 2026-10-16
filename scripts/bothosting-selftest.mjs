import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const fake={
  ...process.env,
  TELEGRAM_BOT_TOKEN:'123456789:FAKE_NOT_LIVE',
  TELEGRAM_WEBHOOK_SECRET:'test_no_real_webhook_secret',
  BOT_OWNER_ID:'123456789',
  SETUP_SECRET:'fake_setup_key',
  PUBLIC_BASE_URL:'https://example.apps.bot-hosting.net',
  TURSO_DATABASE_URL:'libsql://example.invalid',
  TURSO_AUTH_TOKEN:'fake-turso',
  GITHUB_ACTIONS_TOKEN:'fake-gh',
  BAYARCASH_API_SECRET_KEY:'fake-secret',
  BAYARCASH_API_TOKEN:'fake-token',
  BAYARCASH_PORTAL_KEY:'fake-portal',
  PAYPING_SHARED_CONFIG_ENABLED:'true',
  MEDIAX_BOTHOSTING_ACTIVE:'false',
  MEDIAX_BOTHOSTING_AUTO_WEBHOOK:'false',
  MEDIAX_BOTHOSTING_CUTOVER_APPROVED:'false',
};
function check(env,argv=['--config-check']){
  return spawnSync(process.execPath,['scripts/bothosting-start.mjs',...argv],{
    cwd:process.cwd(),env,encoding:'utf8',timeout:20000
  });
}
const good=check(fake);
assert.equal(good.status,0,'synthetic ENV must pass offline config check: '+good.stderr);
assert.match(good.stdout,/Preflight passed/);
for(const key of ['PAYPING_SHARED_CONFIG_ENABLED','PUBLIC_BASE_URL','BAYARCASH_API_TOKEN']){
  const invalid={...fake,[key]:''};
  assert.notEqual(check(invalid).status,0,key+' is required');
}
assert.notEqual(check({...fake,PUBLIC_BASE_URL:'http://localhost:3000'}).status,0,'public HTTPS required');
assert.notEqual(check({...fake,MEDIAX_BOTHOSTING_ACTIVE:'false'},[]).status,0,'inactive Bot Hosting cannot start');
assert.notEqual(check({...fake,MEDIAX_BOTHOSTING_ACTIVE:'true',MEDIAX_BOTHOSTING_AUTO_WEBHOOK:'true'},[]).status,0,'webhook cutover requires explicit approval');
const hook=spawnSync(process.execPath,['scripts/bothosting-webhook.mjs'],{
  env:fake,encoding:'utf8',timeout:5000
});
assert.notEqual(hook.status,0,'webhook helper must deny unapproved execution without network calls');
console.log('[BOTHOSTING] Offline safety tests passed (no live Telegram, Bayarcash or database calls).');
