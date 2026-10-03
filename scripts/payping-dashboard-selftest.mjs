import { unlink } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';

const dbPath=`/tmp/payping-dashboard-selftest-${process.pid}.db`;
await unlink(dbPath).catch(()=>{});
process.env.TURSO_DATABASE_URL=`file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN='local-selftest';
process.env.BAYARCASH_SANDBOX='true';

const { getSupportDb, currentSupportEnvironment } = await import('../src/support/store.js');
const { ensureSubmissionSchema } = await import('../src/support/submissions.js');
const { getPayPingDashboard, listPayPingTransactions } = await import('../src/payping/dashboard.js');

function assert(v,m){if(!v)throw new Error(m)}
await ensureSubmissionSchema();
const db=await getSupportDb();
const env=currentSupportEnvironment();
const now=new Date().toISOString();

await db.batch([
  {sql:`INSERT INTO support_orders(environment,order_number,telegram_user_id,telegram_username,amount_cents,status,gateway_transaction_id,created_at,updated_at,paid_at)
        VALUES(?,?,?,?,?,'PAID',?,?,?,?)`,args:[env,'PP-A-1','900001','user_a',1000,'TX-A-1',now,now,now]},
  {sql:`INSERT INTO support_orders(environment,order_number,telegram_user_id,telegram_username,amount_cents,status,gateway_transaction_id,created_at,updated_at,paid_at)
        VALUES(?,?,?,?,?,'PAID',?,?,?,?)`,args:[env,'PP-B-1','900002','user_b',2000,'TX-B-1',now,now,now]},
  {sql:`INSERT INTO support_orders(environment,order_number,telegram_user_id,telegram_username,amount_cents,status,created_at,updated_at)
        VALUES(?,?,?,?,?,'CREATING',?,?)`,args:[env,'PP-A-2','900001','user_a',500,now,now]},
  {sql:`INSERT INTO support_submissions(environment,order_number,telegram_user_id,telegram_username,amount_cents,tier_key,tier_label,display_name,state,created_at,updated_at)
        VALUES(?,?,?,?,?,'supporter','🤍 Supporter','Alice','PAID',?,?)`,args:[env,'PP-A-1','900001','user_a',1000,now,now]},
  {sql:`INSERT INTO support_submissions(environment,order_number,telegram_user_id,telegram_username,amount_cents,tier_key,tier_label,display_name,state,created_at,updated_at)
        VALUES(?,?,?,?,?,'super','🌟 Super Supporter','Bob','PAID',?,?)`,args:[env,'PP-B-1','900002','user_b',2000,now,now]},
], 'write');

const user=await getPayPingDashboard({userId:'900001',owner:false});
assert(user.summary.totalTransactions===2,'user dashboard must only include own two orders');
assert(user.summary.paidTransactions===1,'user paid count should be 1');
assert(user.summary.pendingTransactions===1,'user pending count should be 1');
assert(user.summary.totalReceived==='10.00','user total received should be RM10');
assert(user.recent.every(x=>x.userId==='900001'),'user recent list leaked another user');

const owner=await getPayPingDashboard({userId:'900001',owner:true});
assert(owner.summary.totalTransactions===3,'owner should see all three orders');
assert(owner.summary.paidTransactions===2,'owner paid count should be 2');
assert(owner.summary.totalReceived==='30.00','owner total received should be RM30');

const paid=await listPayPingTransactions({userId:'900001',owner:false,status:'PAID'});
assert(paid.length===1&&paid[0].transactionId==='TX-A-1','paid filter failed');

const search=await listPayPingTransactions({userId:'900001',owner:true,search:'PP-B-1'});
assert(search.length===1&&search[0].userId==='900002','owner search failed');

const [api,identity,home,page,server,router,vercel]=await Promise.all([
  readFile('handlers/payping-data.js','utf8'),
  readFile('src/payping/identity.js','utf8'),
  readFile('handlers/payping-home-pwa.js','utf8'),
  readFile('handlers/payping-transactions-pwa.js','utf8'),
  readFile('server.js','utf8'),
  readFile('api/router.js','utf8'),
  readFile('vercel.json','utf8'),
]);
const must=(s,m,l)=>{if(!s.includes(m))throw new Error(`${l} missing ${m}`)};
must(api,'resolvePayPingIdentity','unified auth');
must(api,'auth.owner','owner scope');
must(identity,'resolvePushDeviceOwner','legacy device fallback');
must(identity,'BOT_OWNER_ID','owner id scope');
must(home,'Today received','dashboard home');
must(home,"fetch('/api/payping-data?view=dashboard'",'home API');
must(page,"view:'transactions'",'transactions API');
must(server,"['/api/payping-data', payPingDataHandler]",'Node data route');
must(server,"['/ar-payment/transactions', payPingTransactionsPage]",'Node transactions route');
must(router,"['payping-data', payPingDataHandler]",'Vercel data route');
must(router,"['payping-transactions-page', payPingTransactionsPage]",'Vercel transactions route');
const cfg=JSON.parse(vercel);
for(const source of ['/api/payping-data','/ar-payment/transactions','/ar-payment/transactions/']){
  if(!cfg.rewrites.some(x=>x.source===source))throw new Error(`Vercel rewrite missing ${source}`);
}

console.log('PAYPING_DASHBOARD_SELFTEST_OK',JSON.stringify({
  userTotal:user.summary.totalReceived,
  ownerTotal:owner.summary.totalReceived,
  ownerTransactions:owner.summary.totalTransactions,
}));
