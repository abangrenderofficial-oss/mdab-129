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
 const result=method==='getChat'
   ?{id:Number(body.chat_id),type:'supergroup',title:'Test Quote Filter'}
   :method==='getChatMember'?{status:'administrator'}
     :{message_id:sent.length,username:'MediaXTestBot'};
 return new Response(JSON.stringify({ok:true,result}),{headers:{'content-type':'application/json'}});
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
 const submissions=await import('../src/support/submissions.js');
 const gated=await import('../src/support/testimonial-gate.js');
 const supportUI=await import('../src/features/support.js');
 const quotes=await import('../src/support/quote-filter.js');
 const quoteCallbacks=await import('../src/features/quote-filter.js');
 const userMessage=(text)=>({chat:{id:111000111,type:'private'},from:{id:111000111},text});
 const pending=await submissions.getActiveSupportSubmission('111000111');
 assert.equal(pending?.state,'AWAITING_MESSAGE','paid PayPing order must require testimonial before use');
 assert.equal(pending?.orderNumber,'PVCTEST0001');
 assert.ok(sent.some(x=>x.method==='sendMessage'&&String(x.chat_id)==='111000111'&&/Tinggalkan kata-kata support/.test(x.text)),'paid user must be prompted');
 assert.equal(await gated.enforceSupportTestimonialGateForMessage(userMessage('https://vt.tiktok.com/test')),true,'download is blocked before admin approval');
 const groupMessage={chat:{id:-100123456789,type:'supergroup'},from:{id:111000111},text:'https://vt.tiktok.com/test'};
 assert.equal(await gated.enforceSupportTestimonialGateForMessage(groupMessage),true,'group mode cannot bypass paid approval');
 await quotes.setQuoteFilterGroup('-100123456789','Test Quote Filter');
 assert.equal(await supportUI.processSupportMessage(userMessage('Terima kasih kerana bot ni banyak membantu saya')),true);
 assert.equal((await submissions.getActiveSupportSubmission('111000111'))?.state,'AWAITING_NAME');
 assert.equal(await supportUI.processSupportMessage(userMessage('Aiman')),true);
 assert.equal((await submissions.getActiveSupportSubmission('111000111'))?.state,'REVIEW');
 assert.equal(await gated.enforceSupportTestimonialGateForMessage(userMessage('https://vt.tiktok.com/test')),true,'must remain locked while in review');
 const quoteMessage=sent.find(x=>x.method==='sendMessage'&&String(x.chat_id)==='-100123456789'&&x.reply_markup?.inline_keyboard?.length);
 assert.ok(quoteMessage,'support quote must reach the connected admin group');
 const approval=quoteMessage.reply_markup.inline_keyboard[0][0].callback_data;
 assert.match(approval,/^quote:approve:\d+$/);
 assert.equal(await quoteCallbacks.processQuoteFilterCallback({
   id:'test-approval',data:approval,from:{id:999999999},
   message:{chat:{id:-100123456789,type:'supergroup'},message_id:quoteMessage.message_id||1},
 }),true);
 assert.equal((await submissions.getSupportSubmission('PVCTEST0001'))?.state,'PAID','admin approval unlocks testimonial gate');
 assert.equal(await gated.enforceSupportTestimonialGateForMessage(userMessage('https://vt.tiktok.com/test')),false,'approved supporter must be able to download');
 assert.equal((await submissions.ensurePaidSupportSubmission('PVCTEST0001')).created,false,'replayed payment must not reopen approval');
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
 // A repeat legacy callback for an old supporter must NOT suddenly lock them.
 await db.execute({sql:"INSERT INTO support_orders(environment,order_number,telegram_user_id,telegram_username,amount_cents,status,created_at,updated_at,paid_at) VALUES(?,?,?,?,?,?,?,?,?)",args:[E,'LEGACYPAID0003','333000333','',1000,'PAID',t,t,'2026-10-01T12:00:00Z']});
 const {afterSupportTransaction}=await import('../src/support/after-payment.js');
 await afterSupportTransaction({paid:true,becamePaid:false,knownOrder:true,orderNumber:'LEGACYPAID0003',telegramUserId:'333000333',amount:'10.00',totalSupport:'10.00'});
 assert.equal(await submissions.getSupportSubmission('LEGACYPAID0003'),null,'duplicate legacy callback must not retroactively gate an old payer');
 assert.equal(await submissions.getSupportSubmission('PVCTEST0002'),null,'unpaid order never becomes approved/pending testimonial');
 await assert.rejects(submissions.ensurePaidSupportSubmission('PVCTEST0002'),/unverified payment/,'unpaid order cannot create an access gate');
 console.log('PAYPING_PAYMENT_EVENTS_SELFTEST_OK — paid event -> testimonial -> name -> admin approve -> unlock; idempotent; invalid payment refused');
}finally{
 await rm(dir,{recursive:true,force:true});
}
