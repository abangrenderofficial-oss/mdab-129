// MediaX → PayPing new-user notice: signed, right route, username/name passed, bots ignored.
import assert from 'node:assert/strict';
Object.assign(process.env,{TELEGRAM_BOT_TOKEN:'123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',PAYPING_URL:'https://payping.example'});
const {reportPayPingUserJoined}=await import('../src/payping/user-joined-client.js');
const seen=[];const ok=async(url,init)=>{seen.push({url,init});return new Response(JSON.stringify({ok:true,data:{announced:true,display:'@aiman'}}),{status:200})};
assert.deepEqual(await reportPayPingUserJoined({id:555000111,username:'aiman',first_name:'Aiman',last_name:'H'},ok),{announced:true,display:'@aiman'});
assert.equal(seen[0].url,'https://payping.example/api/bot-runtime/mediax/user-joined');
assert.deepEqual(JSON.parse(seen[0].init.body),{telegramUserId:'555000111',username:'aiman',firstName:'Aiman',lastName:'H'});
assert.match(seen[0].init.headers['x-payping-proof-v1'],/^[a-f0-9]{64}$/);
assert.deepEqual(await reportPayPingUserJoined({id:1,is_bot:true},ok),{announced:false,reason:'not_a_person'});
assert.equal(seen.length,1);
await assert.rejects(reportPayPingUserJoined({id:2},async()=>new Response('{}',{status:401})),/not sent/);
console.log('PAYPING_USER_JOINED_SELFTEST_OK — signed, /api/bot-runtime/mediax/user-joined, username and name passed');
