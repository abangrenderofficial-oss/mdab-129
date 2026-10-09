import assert from 'node:assert/strict';
import {createCipheriv,createHash,randomBytes} from 'node:crypto';
import {decryptPayPingBotSecret} from '../handlers/payping-bot-admin.js';

function legacyCiphertext(secret,payload){
  const iv=randomBytes(12);
  const key=createHash('sha256').update('payping-bot-secret-v1:'+secret).digest();
  const enc=createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([enc.update(Buffer.from(payload)),enc.final()]);
  return ['v1',iv.toString('base64url'),enc.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');
}
const envBefore={
  PAYPING_BOT_ENCRYPTION_KEY:process.env.PAYPING_BOT_ENCRYPTION_KEY,
  SETUP_SECRET:process.env.SETUP_SECRET,
  PAYPING_BOT_LEGACY_ENCRYPTION_KEY:process.env.PAYPING_BOT_LEGACY_ENCRYPTION_KEY,
};
try{
  process.env.PAYPING_BOT_ENCRYPTION_KEY='render-test-current-only';
  process.env.SETUP_SECRET='render-test-fallback-ignored';
  delete process.env.PAYPING_BOT_LEGACY_ENCRYPTION_KEY;
  const mock='synthetic-telegram-test-token-never-real';
  const old=legacyCiphertext('vercel-test-legacy-only',mock);
  assert.equal(decryptPayPingBotSecret(old),'','mismatched old key must fail closed');
  process.env.PAYPING_BOT_LEGACY_ENCRYPTION_KEY='vercel-test-legacy-only';
  assert.equal(decryptPayPingBotSecret(old),mock,'known old key should decrypt without rewrite');
  const current=legacyCiphertext('render-test-current-only',mock);
  assert.equal(decryptPayPingBotSecret(current),mock,'new primary key must still work');
  assert.equal(decryptPayPingBotSecret(current+'broken'),'','tampered ciphertext must fail closed');
  assert.equal(decryptPayPingBotSecret('invalid'),'', 'unrecognized payload must fail closed');
  console.log('MEDIAX_RENDER_PAYPING_BOT_KEY_COMPAT_OK — legacy and current keys coexist without rewriting stored bot tokens');
}finally{
  for(const [k,v] of Object.entries(envBefore)){
    if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
}
