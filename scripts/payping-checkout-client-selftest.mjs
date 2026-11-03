// MediaX → PayPing checkout hand-off: signed request, plan by amount, strict PayPing URL.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'mediax-checkout-'));
Object.assign(process.env,{TURSO_DATABASE_URL:'file:'+path.join(dir,'t.db'),TURSO_AUTH_TOKEN:'local-selftest',BAYARCASH_SANDBOX:'false',
 STATS_FILE_PATH:path.join(dir,'s.json'),MEDIAX_STATS_BACKEND:'file',TELEGRAM_BOT_TOKEN:'123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',PAYPING_URL:'https://payping.example'});
try{
 const {getSupportDb,currentSupportEnvironment}=await import('../src/support/store.js');
 const db=await getSupportDb(),E=currentSupportEnvironment(),t=new Date().toISOString();
 await db.execute("CREATE TABLE IF NOT EXISTS payping_plans(environment TEXT NOT NULL,plan_id TEXT NOT NULL,bot_id TEXT NOT NULL,name TEXT NOT NULL,amount_cents INTEGER NOT NULL,duration_days INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(environment,plan_id))");
 await db.execute({sql:"INSERT INTO payping_plans VALUES(?,?,?,?,?,?,?,?,?)",args:[E,'mediax-support-10','mediax','Support RM10',1000,365,'active',t,t]});
 const client=await import('../src/payping/checkout-client.js');
 const seen=[];const token='a'.repeat(64);
 const fakeFetch=async(url,init)=>{seen.push({url,init});return new Response(JSON.stringify({ok:true,data:{url:'https://payping.example/pay/'+token,expiresAt:t}}),{status:201,headers:{'content-type':'application/json'}})};
 const out=await client.prepareMediaXPayPingCheckout({userId:'111000111',username:'@aiman',amount:10},fakeFetch);
 assert.equal(out.url,'https://payping.example/pay/'+token);assert.equal(out.planId,'mediax-support-10');
 assert.equal(seen[0].url,'https://payping.example/api/bot-checkout/mediax/start');
 const body=JSON.parse(seen[0].init.body);assert.deepEqual(body,{telegramUserId:'111000111',telegramUsername:'aiman',planId:'mediax-support-10'});
 assert.match(seen[0].init.headers['x-payping-proof-v1'],/^[a-f0-9]{64}$/,'signed with the bot token');
 await assert.rejects(client.prepareMediaXPayPingCheckout({userId:'111000111',amount:7},fakeFetch),/plan unavailable/,'no plan for RM7');
 const evil=async()=>new Response(JSON.stringify({ok:true,data:{url:'https://evil.example/pay/'+token}}),{status:201});
 await assert.rejects(client.prepareMediaXPayPingCheckout({userId:'111000111',amount:10},evil),/Unexpected PayPing Aurora checkout URL/);
 process.env.TELEGRAM_BOT_TOKEN='not-a-token';
 await assert.rejects(client.prepareMediaXPayPingCheckout({userId:'111000111',amount:10},fakeFetch),/Telegram Bot Token is required/);
 console.log('PAYPING_CHECKOUT_CLIENT_SELFTEST_OK — real token format accepted, signed request, plan by amount, only PayPing /pay URLs');
}finally{await rm(dir,{recursive:true,force:true})}
