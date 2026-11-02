// PayPing → MediaX paid events on a throwaway local database, Telegram mocked.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const dir=await mkdtemp(path.join(tmpdir(),'mediax-events-'));
Object.assign(process.env,{
 TURSO_DATABASE_URL:'file:'+path.join(dir,'t.db'),TURSO_AUTH_TOKEN:'local-selftest',BAYARCASH_SANDBOX:'false',
 PAYPING_SHARED_CONFIG_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123:selftest',TELEGRAM_BOT_USERNAME:'MediaXTestBot',
 STATS_FILE_PATH:path.join(dir,'stats.json'),MEDIAX_STATS_BACKEND:'file',BOT_OWNER_ID:'999999999'
});
const sent=[];
globalThis.fetch=async(url,init={})=>{
 const method=String(url).split('/').pop(),body=JSON.parse(init.body||'{}');
 sent.push({method,...body});
 return new Response(JSON.stringify({ok:true,result:{message_id:sent.length,username:'MediaXTestBot'}}),{headers:{'content-type':'application/json'}});
};
try{
 const {getSupportDb,currentSupportEnvironment}=await import('../src/support/store.js');
 const events=await import('../src/support/payping-payment-events.js');
 const db=await getSupportDb(),E=currentSupportEnvironment(),t=new Date().toISOString();
 assert.deepEqual(await events.consumePayPingPaymentEvents(),{applied:0,table:false},'no table yet: nothing to do');
 await db.execute("CREATE TABLE payping_payment_events_v1(environment TEXT NOT NULL,event_id TEXT NOT NULL,order_number TEXT NOT NULL,bot_id TEXT NOT NULL,gateway TEXT NOT NULL,external_id TEXT NOT NULL DEFAULT '',amount_cents INTEGER NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,consumed_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(environment,event_id))");
 // PayPing created the order and verified it with CHIP.
 await db.execute({sql:"INSERT INTO support_orders(environment,order_number,telegram_user_id,telegram_username,amount_cents,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",args:[E,'PVCTEST0001','111000111','aiman',1000,'PENDING',t,t]});
 await db.execute({sql:"INSERT INTO payping_payment_events_v1(environment,event_id,order_number,bot_id,gateway,external_id,amount_cents,status,created_at) VALUES(?,?,?,?,?,?,?,'paid',?)",args:[E,'PVCTEST0001:paid','PVCTEST0001','mediax','chip','0000aaaa-bbbb',1000,t]});
 // Another bot's event is not MediaX's business.
 await db.execute({sql:"INSERT INTO payping_payment_events_v1(environment,event_id,order_number,bot_id,gateway,external_id,amount_cents,status,created_at) VALUES(?,?,?,?,?,?,?,'paid',?)",args:[E,'OTHER:paid','OTHER','newbot','chip','x',1000,t]});

 assert.equal((await events.consumePayPingPaymentEvents()).applied,1);
 const order=(await db.execute({sql:"SELECT status,paid_at FROM support_orders WHERE order_number=?",args:['PVCTEST0001']})).rows[0];
 assert.equal(order.status,'PAID');assert.ok(order.paid_at);
 const thanks=sent.find(x=>x.method==='sendMessage'&&String(x.chat_id)==='111000111');
 assert.ok(thanks,'user gets the usual confirmation');assert.match(thanks.text,/Support diterima — RM10\.00/);assert.doesNotMatch(thanks.text,/SANDBOX/);
 const ev=(await db.execute("SELECT consumed_at,attempts FROM payping_payment_events_v1 WHERE event_id='PVCTEST0001:paid'")).rows[0];
 assert.match(String(ev.consumed_at),/^\d{4}-/);
 assert.equal((await db.execute("SELECT consumed_at FROM payping_payment_events_v1 WHERE event_id='OTHER:paid'")).rows[0].consumed_at,'');
 const before=sent.length;
 assert.equal((await events.consumePayPingPaymentEvents()).applied,0,'applied once');
 assert.equal(sent.filter((x,i)=>i>=before&&String(x.chat_id)==='111000111').length,0,'no second message');

 // A wrong amount is never applied and is left for PayPing to flag.
 await db.execute({sql:"INSERT INTO support_orders(environment,order_number,telegram_user_id,telegram_username,amount_cents,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",args:[E,'PVCTEST0002','222000222','',2000,'PENDING',t,t]});
 await db.execute({sql:"INSERT INTO payping_payment_events_v1(environment,event_id,order_number,bot_id,gateway,external_id,amount_cents,status,created_at) VALUES(?,?,?,?,?,?,?,'paid',?)",args:[E,'PVCTEST0002:paid','PVCTEST0002','mediax','chip','y',1000,t]});
 assert.equal((await events.consumePayPingPaymentEvents()).applied,0);
 const bad=(await db.execute("SELECT consumed_at,last_error,attempts FROM payping_payment_events_v1 WHERE event_id='PVCTEST0002:paid'")).rows[0];
 assert.equal(bad.consumed_at,'');assert.match(String(bad.last_error),/Amount/);assert.equal(Number(bad.attempts),1);
 assert.notEqual((await db.execute("SELECT status FROM support_orders WHERE order_number='PVCTEST0002'")).rows[0].status,'PAID');
 console.log('PAYPING_PAYMENT_EVENTS_SELFTEST_OK — PayPing-verified payment applied once, usual confirmation, other bots ignored, wrong amount refused');
}finally{
 await rm(dir,{recursive:true,force:true});
}
