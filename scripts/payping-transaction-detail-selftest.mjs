import { unlink } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';

const dbPath=`/tmp/payping-transaction-detail-${process.pid}.db`;
await unlink(dbPath).catch(()=>{});
process.env.TURSO_DATABASE_URL=`file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN='local-selftest';
process.env.BAYARCASH_SANDBOX='true';

const { getSupportDb, currentSupportEnvironment } = await import('../src/support/store.js');
const { ensureSubmissionSchema } = await import('../src/support/submissions.js');
const { ensureWebPushSchema } = await import('../src/support/webpush-payment.js');
const { getPayPingTransactionDetail } = await import('../src/payping/dashboard.js');

function assert(v,m){if(!v)throw new Error(m)}
await Promise.all([ensureSubmissionSchema(),ensureWebPushSchema()]);
const db=await getSupportDb();
const env=currentSupportEnvironment();
const now=new Date().toISOString();

await db.batch([
  {sql:`INSERT INTO support_orders(
          environment,order_number,telegram_user_id,telegram_username,amount_cents,status,
          payment_intent_id,last_gateway_status,status_description,gateway_transaction_id,
          created_at,updated_at,paid_at
        ) VALUES(?,?,?,?,?,'PAID',?,'3','Successful',?,?,?,?)`,
   args:[env,'DETAIL-A','810001','alice',1000,'PI-A','TX-A',now,now,now]},
  {sql:`INSERT INTO support_orders(
          environment,order_number,telegram_user_id,telegram_username,amount_cents,status,
          payment_intent_id,last_gateway_status,status_description,gateway_transaction_id,
          created_at,updated_at,paid_at
        ) VALUES(?,?,?,?,?,'PAID',?,'3','Successful',?,?,?,?)`,
   args:[env,'DETAIL-B','810002','bob',2000,'PI-B','TX-B',now,now,now]},
  {sql:`INSERT INTO support_submissions(
          environment,order_number,telegram_user_id,telegram_username,amount_cents,
          tier_key,tier_label,support_message,display_name,state,created_at,updated_at,announced_at
        ) VALUES(?,?,?,?,?,'supporter','🤍 Supporter','Terima kasih','Alice','PAID',?,?,?)`,
   args:[env,'DETAIL-A','810001','alice',1000,now,now,now]},
  {sql:`INSERT INTO support_submissions(
          environment,order_number,telegram_user_id,telegram_username,amount_cents,
          tier_key,tier_label,support_message,display_name,state,created_at,updated_at,announced_at
        ) VALUES(?,?,?,?,?,'super','🌟 Super Supporter','Keep going','Bob','PAID',?,?,?)`,
   args:[env,'DETAIL-B','810002','bob',2000,now,now,now]},
  {sql:`INSERT INTO support_transactions(
          environment,tx_key,transaction_id,order_number,gateway_status,amount_cents,received_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?)`,
   args:[env,'TX-A','TX-A','DETAIL-A','3',1000,now,now]},
  {sql:`INSERT INTO support_transactions(
          environment,tx_key,transaction_id,order_number,gateway_status,amount_cents,received_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?)`,
   args:[env,'TX-B','TX-B','DETAIL-B','3',2000,now,now]},
  {sql:`INSERT INTO affiliate_commissions(
          environment,commission_id,order_number,referrer_user_id,referred_user_id,
          gross_cents,rate_bps,commission_cents,status,available_at,payout_request_id,
          created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?, 'PENDING', ?, NULL, ?, ?)`,
   args:[env,'AFF:DETAIL-A','DETAIL-A','899999','810001',1000,2000,200,now,now,now]},
  {sql:`INSERT INTO support_push_subscriptions(
          environment,endpoint_hash,endpoint,p256dh,auth,device_token_hash,owner_user_id,created_at,updated_at,disabled_at
        ) VALUES(?,?,?,?,?,?,?,?,?,'')`,
   args:[env,'device-1','https://push.example/device-1','p256dh-1','auth-1','token-1','810001',now,now]},
  {sql:`INSERT INTO support_push_subscriptions(
          environment,endpoint_hash,endpoint,p256dh,auth,device_token_hash,owner_user_id,created_at,updated_at,disabled_at
        ) VALUES(?,?,?,?,?,?,?,?,?,'')`,
   args:[env,'device-2','https://push.example/device-2','p256dh-2','auth-2','token-2','810001',now,now]},
  {sql:`INSERT INTO support_webpush_delivery(
          environment,delivery_key,endpoint_hash,status,last_error,updated_at
        ) VALUES(?,?,'device-1','SENT','',?)`,
   args:[env,'order:DETAIL-A:device-1',now]},
  {sql:`INSERT INTO support_webpush_delivery(
          environment,delivery_key,endpoint_hash,status,last_error,updated_at
        ) VALUES(?,?,'device-2','FAILED','network_test',?)`,
   args:[env,'order:DETAIL-A:device-2',now]},
], 'write');

const own=await getPayPingTransactionDetail({userId:'810001',owner:false,orderNumber:'DETAIL-A'});
assert(own?.transaction?.orderNumber==='DETAIL-A','own transaction detail missing');
assert(own.transaction.paymentIntentId==='','non-owner must not receive payment intent id');
assert(own.affiliate.generated===true,'non-owner should know affiliate was generated');
assert(!('commissionAmount' in own.affiliate),'non-owner must not receive affiliate earnings');
assert(own.callbacks.length===1&&own.callbacks[0].transactionId==='TX-A','callback history missing');
assert(own.notification.total===2&&own.notification.sent===1&&own.notification.failed===1,'push delivery summary incorrect');

const blocked=await getPayPingTransactionDetail({userId:'810001',owner:false,orderNumber:'DETAIL-B'});
assert(blocked===null,'user A must not access user B transaction');

const owner=await getPayPingTransactionDetail({userId:'810001',owner:true,orderNumber:'DETAIL-A'});
assert(owner.transaction.paymentIntentId==='PI-A','owner payment intent missing');
assert(owner.affiliate.commissionAmount==='2.00','owner affiliate commission amount incorrect');
assert(owner.affiliate.referrerUserId==='899999','owner referrer detail missing');

const [api,page,txPage,home,server,router,vercel]=await Promise.all([
  readFile('handlers/payping-data.js','utf8'),
  readFile('handlers/payping-transaction-detail-pwa.js','utf8'),
  readFile('handlers/payping-transactions-pwa.js','utf8'),
  readFile('handlers/payping-home-pwa.js','utf8'),
  readFile('server.js','utf8'),
  readFile('api/router.js','utf8'),
  readFile('vercel.json','utf8'),
]);
const must=(s,m,l)=>{if(!s.includes(m))throw new Error(`${l} missing ${m}`)};
must(api,"view==='transaction'",'transaction detail API');
must(api,'TRANSACTION_NOT_FOUND','transaction access denial');
must(page,'Bayarcash Callback History','detail callback UI');
must(page,'Affiliate Commission','detail affiliate UI');
must(page,'Notification Delivery','detail notification UI');
must(txPage,'/ar-payment/transaction?order=','transactions detail link');
must(home,'/ar-payment/transaction?order=','home recent detail link');
must(server,"['/ar-payment/transaction', payPingTransactionDetailPage]",'Node detail route');
must(router,"['payping-transaction-detail-page', payPingTransactionDetailPage]",'Vercel detail route');
const cfg=JSON.parse(vercel);
if(!cfg.rewrites.some(x=>x.source==='/ar-payment/transaction')){
  throw new Error('Vercel transaction detail rewrite missing');
}

console.log('PAYPING_TRANSACTION_DETAIL_SELFTEST_OK',JSON.stringify({
  ownOrder:own.transaction.orderNumber,
  callbackCount:own.callbacks.length,
  push:own.notification,
  crossUserBlocked:blocked===null,
  ownerCommission:owner.affiliate.commissionAmount,
}));
