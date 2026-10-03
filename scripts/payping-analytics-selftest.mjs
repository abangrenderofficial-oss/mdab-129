import { unlink } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';

const dbPath=`/tmp/payping-analytics-selftest-${process.pid}.db`;
await unlink(dbPath).catch(()=>{});
process.env.TURSO_DATABASE_URL=`file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN='local-selftest';
process.env.BAYARCASH_SANDBOX='true';

const { getSupportDb, currentSupportEnvironment } = await import('../src/support/store.js');
const { ensureSubmissionSchema } = await import('../src/support/submissions.js');
const { getPayPingAnalytics, getPayPingAnalyticsExport } = await import('../src/payping/dashboard.js');

function assert(v,m){if(!v)throw new Error(m)}
await ensureSubmissionSchema();
const db=await getSupportDb();
const env=currentSupportEnvironment();
const now=new Date().toISOString();
const old=new Date(Date.now()-(10*24*60*60*1000)).toISOString();

await db.batch([
  {sql:`INSERT INTO support_orders(environment,order_number,telegram_user_id,telegram_username,amount_cents,status,gateway_transaction_id,created_at,updated_at,paid_at)
        VALUES(?,?,?,?,?,'PAID',?,?,?,?)`,args:[env,'AN-REC-A','910001','alpha',1000,'TX-AN-A',now,now,now]},
  {sql:`INSERT INTO support_orders(environment,order_number,telegram_user_id,telegram_username,amount_cents,status,gateway_transaction_id,created_at,updated_at,paid_at)
        VALUES(?,?,?,?,?,'PAID',?,?,?,?)`,args:[env,'AN-REC-B','910002','beta',2000,'TX-AN-B',now,now,now]},
  {sql:`INSERT INTO support_orders(environment,order_number,telegram_user_id,telegram_username,amount_cents,status,gateway_transaction_id,created_at,updated_at,paid_at)
        VALUES(?,?,?,?,?,'PAID',?,?,?,?)`,args:[env,'AN-OLD-A','910001','alpha',5000,'TX-AN-C',old,old,old]},
  {sql:`INSERT INTO support_orders(environment,order_number,telegram_user_id,telegram_username,amount_cents,status,created_at,updated_at)
        VALUES(?,?,?,?,?,'PENDING',?,?)`,args:[env,'AN-PENDING','910003','gamma',9900,now,now]},
  {sql:`INSERT INTO support_submissions(environment,order_number,telegram_user_id,telegram_username,amount_cents,tier_key,tier_label,display_name,state,created_at,updated_at)
        VALUES(?,?,?,?,?,'supporter','🤍 Supporter','Alpha','PAID',?,?)`,args:[env,'AN-REC-A','910001','alpha',1000,now,now]},
  {sql:`INSERT INTO support_submissions(environment,order_number,telegram_user_id,telegram_username,amount_cents,tier_key,tier_label,display_name,state,created_at,updated_at)
        VALUES(?,?,?,?,?,'super','🌟 Super Supporter','Beta','PAID',?,?)`,args:[env,'AN-REC-B','910002','beta',2000,now,now]},
  {sql:`INSERT INTO support_submissions(environment,order_number,telegram_user_id,telegram_username,amount_cents,tier_key,tier_label,display_name,state,created_at,updated_at)
        VALUES(?,?,?,?,?,'ultimate','🏆 Ultimate Supporter','Alpha','PAID',?,?)`,args:[env,'AN-OLD-A','910001','alpha',5000,old,old]},
  {sql:`INSERT INTO affiliate_commissions(environment,commission_id,order_number,referrer_user_id,referred_user_id,gross_cents,rate_bps,commission_cents,status,available_at,payout_request_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?, 'PENDING', ?, NULL, ?, ?)`,args:[env,'AFF:AN-REC-A','AN-REC-A','999001','910001',1000,2000,200,now,now,now]},
  {sql:`INSERT INTO affiliate_commissions(environment,commission_id,order_number,referrer_user_id,referred_user_id,gross_cents,rate_bps,commission_cents,status,available_at,payout_request_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?, 'PAID', ?, 'AW-OLD', ?, ?)`,args:[env,'AFF:AN-OLD-A','AN-OLD-A','999001','910001',5000,2000,1000,old,old,old]},
], 'write');

let ownerOnly=false;
try{await getPayPingAnalytics({owner:false,range:'30d'})}catch(error){ownerOnly=error?.code==='PAYPING_OWNER_ONLY'}
assert(ownerOnly,'analytics must be owner-only');

const seven=await getPayPingAnalytics({owner:true,range:'7d'});
assert(seven.summary.received==='30.00','7d received should be RM30');
assert(seven.summary.payments===2,'7d should include two paid transactions');
assert(seven.summary.uniqueSupporters===2,'7d unique supporters should be two');
assert(seven.summary.averagePayment==='15.00','7d average should be RM15');
assert(seven.summary.affiliateCost==='2.00','7d affiliate cost should be RM2');
assert(seven.summary.netAfterAffiliate==='28.00','7d net should be RM28');
assert(seven.tiers.length===2,'7d should have two tiers');
assert(seven.topSupporters.length===2,'7d should have two supporters');
assert(seven.daily.length>=1,'daily series missing');
assert(seven.monthly.length>=1,'monthly series missing');

const thirty=await getPayPingAnalytics({owner:true,range:'30d'});
assert(thirty.summary.received==='80.00','30d received should be RM80');
assert(thirty.summary.payments===3,'30d should include three paid transactions');
assert(thirty.summary.uniqueSupporters===2,'30d unique supporters should be two');
assert(thirty.summary.affiliateCost==='12.00','30d affiliate cost should be RM12');
assert(thirty.summary.affiliatePaid==='10.00','30d paid affiliate should be RM10');
assert(thirty.summary.netAfterAffiliate==='68.00','30d net should be RM68');
assert(thirty.topSupporters[0].userId==='910001','Alpha should be top supporter');
assert(thirty.topSupporters[0].amount==='60.00','Alpha total should be RM60');

const exported=await getPayPingAnalyticsExport({owner:true,range:'7d'});
assert(exported.rows.length===2,'7d export should contain two paid rows');
assert(exported.rows.every(x=>x.status==='PAID'),'export must only contain paid transactions');
assert(exported.rows.some(x=>x.affiliateCommission==='2.00'),'export affiliate commission missing');

const [api,page,home,settings,server,router,vercel]=await Promise.all([
  readFile('handlers/payping-data.js','utf8'),
  readFile('handlers/payping-analytics-pwa.js','utf8'),
  readFile('handlers/payping-home-pwa.js','utf8'),
  readFile('handlers/payping-settings-pwa.js','utf8'),
  readFile('server.js','utf8'),
  readFile('api/router.js','utf8'),
  readFile('vercel.json','utf8'),
]);
const must=(s,m,l)=>{if(!s.includes(m))throw new Error(`${l} missing ${m}`)};
must(api,"view==='analytics'",'analytics API');
must(api,"view==='analytics-export'",'analytics export API');
must(api,'PAYPING_OWNER_ONLY','owner API guard');
must(page,'Daily Revenue','daily analytics UI');
must(page,'Monthly Revenue','monthly analytics UI');
must(page,'Top Supporters','top supporters UI');
must(page,'Support Tier Breakdown','tier breakdown UI');
must(page,'Export CSV','CSV export UI');
must(page,"if(/^[=+\\-@]/.test(s))", 'CSV formula injection guard');
must(home,'analyticsQuick','owner home analytics link');
must(settings,'analyticsLink','owner settings analytics link');
must(server,"['/ar-payment/analytics', payPingAnalyticsPage]",'Node analytics route');
must(router,"['payping-analytics-page', payPingAnalyticsPage]",'Vercel analytics route');
const cfg=JSON.parse(vercel);
if(!cfg.rewrites.some(x=>x.source==='/ar-payment/analytics'))throw new Error('Vercel analytics rewrite missing');

console.log('PAYPING_ANALYTICS_SELFTEST_OK',JSON.stringify({
  sevenReceived:seven.summary.received,
  thirtyReceived:thirty.summary.received,
  affiliateCost:thirty.summary.affiliateCost,
  topSupporter:thirty.topSupporters[0].userId,
  exportRows:exported.rows.length,
  ownerOnly,
}));
