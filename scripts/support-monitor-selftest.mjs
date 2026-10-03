import { unlink } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';

const dbPath=`/tmp/support-monitor-selftest-${process.pid}.db`;
await unlink(dbPath).catch(()=>{});
process.env.TURSO_DATABASE_URL=`file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN='local-selftest';
process.env.BAYARCASH_SANDBOX='true';
process.env.BOT_OWNER_ID='999999999';

const { getSupportDb, currentSupportEnvironment } = await import('../src/support/store.js');
const { recordSupportMonitorSeen, getSupportMonitorUserStatus, getSupportMonitorReport } = await import('../src/support/monitor.js');

function assert(v,m){if(!v)throw new Error(m)}
const db=await getSupportDb();
const env=currentSupportEnvironment();
const now=new Date().toISOString();

await db.batch([
  `CREATE TABLE IF NOT EXISTS support_daily_force_mode (
    environment TEXT NOT NULL PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    cycle_id INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS support_daily_force_usage (
    environment TEXT NOT NULL,
    telegram_user_id TEXT NOT NULL,
    cycle_id INTEGER NOT NULL,
    used_once INTEGER NOT NULL DEFAULT 0,
    use_claimed INTEGER NOT NULL DEFAULT 0,
    prompt_sent INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (environment, telegram_user_id, cycle_id)
  )`,
], 'write');

await db.batch([
  {sql:`INSERT INTO support_daily_force_mode(environment,enabled,cycle_id,updated_by,updated_at)
        VALUES(?,1,7,'999999999',?)`,args:[env,now]},
  {sql:`INSERT INTO support_daily_force_usage(environment,telegram_user_id,cycle_id,used_once,use_claimed,prompt_sent,success_count,updated_at)
        VALUES(?, '200002', 7, 1, 0, 1, 1, ?)`,args:[env,now]},
  {sql:`INSERT INTO support_daily_force_usage(environment,telegram_user_id,cycle_id,used_once,use_claimed,prompt_sent,success_count,updated_at)
        VALUES(?, '200004', 7, 1, 0, 1, 2, ?)`,args:[env,now]},
], 'write');

await recordSupportMonitorSeen({id:200001,username:'supporter',first_name:'Active',last_name:'Supporter'});
await recordSupportMonitorSeen({id:200002,username:'locked',first_name:'Locked',last_name:'User'});
await recordSupportMonitorSeen({id:200003,username:'freeuser',first_name:'Free',last_name:'User'});
await recordSupportMonitorSeen({id:200004,username:'anomaly',first_name:'Anomaly',last_name:'User'});
await recordSupportMonitorSeen({id:999999999,username:'owner',first_name:'Owner'});

await db.batch([
  {sql:`INSERT INTO support_orders(
          environment,order_number,telegram_user_id,telegram_username,amount_cents,status,
          gateway_transaction_id,created_at,updated_at,paid_at
        ) VALUES(?,?,?,?,?,'PAID','TX-MONITOR',?,?,?)`,
   args:[env,'MON-SUP-1','200001','supporter',1000,now,now,now]},
  {sql:`INSERT INTO support_submissions(
          environment,order_number,telegram_user_id,telegram_username,amount_cents,
          tier_key,tier_label,display_name,state,created_at,updated_at
        ) VALUES(?,?,?,?,?,'supporter','🤍 Supporter','Active Supporter','PAID',?,?)`,
   args:[env,'MON-SUP-1','200001','supporter',1000,now,now]},
], 'write');

const supporter=await getSupportMonitorUserStatus('200001');
assert(supporter.support.active===true,'supporter should be active');
assert(supporter.dailyForce.state==='EXEMPT_SUPPORTER','supporter should be exempt');

const locked=await getSupportMonitorUserStatus('200002');
assert(locked.support.active===false,'locked user should be unsupported');
assert(locked.dailyForce.state==='LOCKED','used non-supporter should be locked');
assert(locked.dailyForce.successCount===1,'locked user success count should be 1');
assert(locked.dailyForce.anomaly===false,'success=1 should not be anomaly');

const free=await getSupportMonitorUserStatus('200003');
assert(free.dailyForce.state==='FREE_USE_AVAILABLE','unused non-supporter should have free use');

const anomaly=await getSupportMonitorUserStatus('200004');
assert(anomaly.dailyForce.state==='LOCKED','anomaly user should be locked');
assert(anomaly.dailyForce.successCount===2,'anomaly success count should be 2');
assert(anomaly.dailyForce.anomaly===true,'success>1 must flag anomaly');

const report=await getSupportMonitorReport(80);
assert(report.supported.some(x=>x.userId==='200001'),'report missing active supporter');
assert(report.locked.some(x=>x.userId==='200002'),'report missing locked user');
assert(report.anomalies.some(x=>x.userId==='200004'),'report missing anomaly user');
assert(!report.users.some(x=>x.userId==='999999999'),'owner must be excluded from monitor list');

const [audit,paymentDetail,router,menu,daily]=await Promise.all([
  readFile('src/bot/audit.js','utf8'),
  readFile('src/features/payment-detail.js','utf8'),
  readFile('handlers/telegram.js','utf8'),
  readFile('src/bot/commands.js','utf8'),
  readFile('src/support/daily-force.js','utf8'),
]);
const must=(s,m,l)=>{if(!s.includes(m))throw new Error(`${l} missing ${m}`)};
must(audit,'❤️ Support: ✅ ACTIVE','audit active support label');
must(audit,'❤️ Support: ❌ BELUM SUPPORT','audit unsupported label');
must(audit,'Daily Force: LOCKED','audit daily lock label');
must(paymentDetail,'export async function handleSupportMonitorCommand','monitor command');
must(paymentDetail,'export async function handleSupportCheckCommand','support check command');
must(paymentDetail,'⚠️ Cycle anomaly (>1 success)','monitor anomaly summary');
must(router,"command === '/supportmonitor'",'supportmonitor route');
must(router,"command === '/supportcheck'",'supportcheck route');
must(menu,'/supportmonitor','admin menu monitor');
must(daily,'success_count = COALESCE(success_count, 0) + 1','daily success counter');

console.log('SUPPORT_MONITOR_SELFTEST_OK',JSON.stringify({
  supported:report.supported.length,
  unsupported:report.unsupported.length,
  locked:report.locked.length,
  anomalies:report.anomalies.length,
  cycle:report.cycleId,
}));
