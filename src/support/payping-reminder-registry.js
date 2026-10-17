// Recipient identity only. Scheduling, messages and delivery are owned by PayPing Aurora.
import {readFile} from 'node:fs/promises';
import {currentSupportEnvironment,getSupportDb} from './store.js';
import {isPayPingSharedConfigEnabled} from './payping-shared-config.js';
const file=String(process.env.STATS_FILE_PATH||'/data/bot-stats.json');
const memo=new Set();let ready=null;
async function ensureRegistry(){
 if(!ready)ready=(async()=>{
  const db=await getSupportDb();
  await db.execute("CREATE TABLE IF NOT EXISTS payping_reminder_recipients_v3(environment TEXT NOT NULL,bot_id TEXT NOT NULL,telegram_user_id TEXT NOT NULL,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,PRIMARY KEY(environment,bot_id,telegram_user_id))");
 })().catch(e=>{ready=null;throw e});
 return ready;
}
export async function recordMediaXRecipient(userId,chatType='private'){
 const id=String(userId||'');
 if(!isPayPingSharedConfigEnabled()||chatType!=='private'||!/^[0-9]{1,20}$/.test(id)||memo.has(id))return false;
 await ensureRegistry();const db=await getSupportDb(),t=new Date().toISOString();
 await db.execute({sql:"INSERT OR IGNORE INTO payping_reminder_recipients_v3(environment,bot_id,telegram_user_id,first_seen_at,last_seen_at) VALUES(?,'mediax',?,?,?)",args:[currentSupportEnvironment(),id,t,t]});
 if(memo.size>15000)memo.clear();
 memo.add(id);return true;
}
export async function seedMediaXReminderRecipients(){
 if(!isPayPingSharedConfigEnabled())return {skipped:true};
 await ensureRegistry();
 // Bot-Hosting uses Turso's durable stats snapshot instead of Railway's /data volume.
 // Never seed an empty audience when that snapshot is missing or corrupted.
 let data;
 if(String(process.env.MEDIAX_STATS_BACKEND||'file').trim().toLowerCase()==='turso'){
  const db=await getSupportDb();
  const namespace=String(process.env.MEDIAX_STATS_NAMESPACE||'mediax-production');
  const result=await db.execute({sql:"SELECT payload_json FROM mediax_statistics_snapshot WHERE namespace=? LIMIT 1",args:[namespace]});
  if(!result.rows?.length)throw new Error('MediaX Turso statistics snapshot missing; reminders not modified');
  data=JSON.parse(String(result.rows[0].payload_json||'null'));
  if(!data?.users||typeof data.users!=='object'||Array.isArray(data.users))throw new Error('Invalid Turso stats snapshot; reminders not modified');
 }else{
  data=JSON.parse(await readFile(file,'utf8'));
 }
 const ids=Object.keys(data?.users||{}).filter(id=>/^[0-9]{1,20}$/.test(id));
 const db=await getSupportDb(),env=currentSupportEnvironment(),t=new Date().toISOString();
 for(let i=0;i<ids.length;i+=100){
  const statements=ids.slice(i,i+100).map(id=>({sql:"INSERT OR IGNORE INTO payping_reminder_recipients_v3(environment,bot_id,telegram_user_id,first_seen_at,last_seen_at) VALUES(?,'mediax',?,?,?)",args:[env,id,t,t]}));
  await db.batch(statements,'write');
 }
 console.log('[payping-reminders] MediaX recipients synchronized',{users:ids.length});
 return {users:ids.length};
}
