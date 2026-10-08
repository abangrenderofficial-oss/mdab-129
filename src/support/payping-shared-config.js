import {currentSupportEnvironment,getSupportDb} from './store.js';

const FALLBACK_AMOUNTS=Object.freeze([10,20,30,50,100]);
const cache={amounts:[...FALLBACK_AMOUNTS],checked:0,version:0};
let refreshTask=null;
let lastHeartbeat=0;
export const isPayPingSharedConfigEnabled=()=>String(process.env.PAYPING_SHARED_CONFIG_ENABLED||'').toLowerCase()==='true';
export function currentSupportAmounts(){return isPayPingSharedConfigEnabled()?[...cache.amounts]:[...FALLBACK_AMOUNTS]}
function validAmount(n){return Number.isFinite(n)&&n>=1&&n<=1000000&&Math.abs(Math.round(n*100)-n*100)<0.000001}
export function deriveActiveMediaXAmounts(rows){const a=rows.filter(r=>String(r.status)==='active').map(r=>Number(r.amount_cents)/100).filter(validAmount);return [...new Set(a)].sort((a,b)=>a-b)}
export async function refreshSupportAmounts(force=false){
 if(!isPayPingSharedConfigEnabled())return currentSupportAmounts();
 if(!force&&Date.now()-cache.checked<15000)return currentSupportAmounts();
 if(refreshTask)return refreshTask;
 refreshTask=(async()=>{
  const db=await getSupportDb();
  const result=await db.execute({sql:"SELECT amount_cents,status FROM payping_plans WHERE environment=? AND bot_id='mediax' ORDER BY amount_cents",args:[currentSupportEnvironment()]});
  const source=result.rows||[];
  cache.amounts=source.length?deriveActiveMediaXAmounts(source):[...FALLBACK_AMOUNTS];
  cache.checked=Date.now();cache.version++;
  return currentSupportAmounts();
 })().finally(()=>{refreshTask=null});
 return refreshTask;
}
export async function isSupportAmountCurrentlyActive(amount){
 if(!validAmount(amount))return false;
 if(!isPayPingSharedConfigEnabled())return FALLBACK_AMOUNTS.includes(amount);
 // Never trust stale cached buttons when generating a payment checkout.
 const db=await getSupportDb();
 const r=await db.execute({sql:"SELECT amount_cents,status FROM payping_plans WHERE environment=? AND bot_id='mediax'",args:[currentSupportEnvironment()]});
 const existing=r.rows||[];
 if(!existing.length)return FALLBACK_AMOUNTS.includes(amount);
 return existing.some(x=>x.status==='active'&&Number(x.amount_cents)===Math.round(amount*100));
}
export async function publishSharedForceState(enabled,source='telegram'){
 if(!isPayPingSharedConfigEnabled())return false;
 // V2 reads the original support_daily_force_mode row directly. This mirror
 // keeps its independent policy snapshot consistent for other API consumers.
 const db=await getSupportDb();
 const t=new Date().toISOString(),env=currentSupportEnvironment();
 await db.execute({
  sql:"INSERT INTO payping_access_policies_v2(environment,bot_id,mode,updated_at) VALUES(?,'mediax',?,?) ON CONFLICT(environment,bot_id) DO UPDATE SET mode=excluded.mode,updated_at=excluded.updated_at",
  args:[env,enabled?'force_support':'free',t]
 }).catch(e=>{console.warn('[payping-shared] policy mirror failed:',e.message)});
 return true;
}
export async function reportPayPingSync(){
 if(!isPayPingSharedConfigEnabled()||Date.now()-lastHeartbeat<45000)return;
 lastHeartbeat=Date.now();
 try {
  const db=await getSupportDb();
  const t=new Date().toISOString();
  await db.execute({sql:"INSERT INTO payping_bot_sync_status_v2(environment,bot_id,last_seen_at,config_version,updated_at) VALUES(?,'mediax',?,'mediax-shared-v1',?) ON CONFLICT(environment,bot_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,config_version=excluded.config_version,updated_at=excluded.updated_at",args:[currentSupportEnvironment(),t,t]});
 }catch(e){console.warn('[payping-shared] heartbeat unavailable:',e.message)}
}

let backgroundStarted=false;
export function startSharedConfigHeartbeat(){
  if(!isPayPingSharedConfigEnabled()||backgroundStarted)return;
  backgroundStarted=true;
  const run=()=>Promise.allSettled([refreshSupportAmounts(true),reportPayPingSync()]).then(results=>{
    for(const entry of results)if(entry.status==='rejected')console.warn('[payping-shared] background sync failed:',entry.reason?.message||'unknown');
  });
  void run();
  const interval=setInterval(()=>void run(),90_000);
  interval.unref?.();
}
