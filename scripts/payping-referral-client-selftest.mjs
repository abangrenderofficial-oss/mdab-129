// MediaX → PayPing referral: only PayPing codes (ref_AR…), signed request, right route and body.
import assert from 'node:assert/strict';
Object.assign(process.env,{TELEGRAM_BOT_TOKEN:'123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',PAYPING_URL:'https://payping.example'});
const c=await import('../src/payping/referral-client.js');
assert.equal(c.paypingReferralCode('ref_ar9ae5c0d1e2f3'),'AR9AE5C0D1E2F3');
assert.equal(c.paypingReferralCode('ref_MXCODE12'),'','MediaX legacy codes stay with MediaX');
assert.equal(c.paypingReferralCode('inv_abc'),'');
const seen=[];
const ok=async(url,init)=>{seen.push({url,init});return new Response(JSON.stringify({ok:true,data:{recorded:true}}),{status:200})};
assert.deepEqual(await c.reportPayPingReferral({userId:555000111,payload:'ref_AR9AE5C0D1E2F3',messageId:42},ok),{recorded:true});
assert.equal(seen[0].url,'https://payping.example/api/bot-referrals/mediax/join');
assert.deepEqual(JSON.parse(seen[0].init.body),{telegramUserId:'555000111',referralCode:'AR9AE5C0D1E2F3',eventId:'tgstart:555000111:42'});
assert.match(seen[0].init.headers['x-payping-proof-v1'],/^[a-f0-9]{64}$/);
assert.deepEqual(await c.reportPayPingReferral({userId:1,payload:'ref_MXCODE12'},ok),{recorded:false,reason:'not_payping_code'});
assert.equal(seen.length,1,'legacy code makes no PayPing call');
await assert.rejects(c.reportPayPingReferral({userId:1,payload:'ref_AR9AE5C0D1E2F3'},async()=>new Response('{}',{status:401})),/not recorded/);
console.log('PAYPING_REFERRAL_CLIENT_SELFTEST_OK — PayPing codes only, signed, /api/bot-referrals/mediax/join');
