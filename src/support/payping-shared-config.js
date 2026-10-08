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


// Access policy stays separate from the downloader; only the channel
// gate consults this small, bounded cache. Existing fifth-Premium-HQ
// enforcement is preserved unless Free + Channel is selected.
let channelRule={checked:0,value:null};
let channelRuleTask=null;
export function parseMediaXChannelRule(row){
  if(!row||String(row.mode)!=='free_channel')return null;
  const channel=String(row.channel_id||'').trim();
  const campaignSequence=Number(row.campaign_seq);
  // Never activate a legacy channel policy without a deliberately started
  // campaign. This prevents pre-activation HQ history from locking users.
  if(!/^@[A-Za-z0-9_]{5,}$/.test(channel)||channel!==String(row.campaign_channel_id||''))return null;
  if(!Number.isSafeInteger(campaignSequence)||campaignSequence<1||!String(row.activated_at||''))return null;
  return {mode:'free_channel',channel,threshold:1,campaignSequence};
}
export async function getMediaXChannelRule(){
  if(!isPayPingSharedConfigEnabled())return null;
  if(Date.now()-channelRule.checked<10000)return channelRule.value;
  if(channelRuleTask)return channelRuleTask;
  channelRuleTask=(async()=>{
    try{
      const client=await getSupportDb();
      const result=await client.execute({sql:"SELECT p.mode,p.channel_id,p.channel_after,c.campaign_seq,c.channel_id AS campaign_channel_id,c.activated_at FROM payping_access_policies_v2 p LEFT JOIN payping_channel_campaign_v2 c ON c.environment=p.environment AND c.bot_id=p.bot_id WHERE p.environment=? AND p.bot_id='mediax' LIMIT 1",args:[currentSupportEnvironment()]});
      channelRule.value=parseMediaXChannelRule(result.rows?.[0]);
      channelRule.checked=Date.now();
    }catch(error){
      console.warn('[payping-shared] channel policy lookup failed; keeping previous rule:',error?.message);
      // Do not drop a previously active channel rule during a DB outage.
      channelRule.checked=Date.now();
    }
    return channelRule.value;
  })().finally(()=>{channelRuleTask=null});
  return channelRuleTask;
}



/**
 * Telegram and PayPing Access Control share the SAME row. Repeating the
 * Free+Channel command must not restart the user's successful-use quota.
 */
export async function setMediaXFreeAccessMode(){
 if(!isPayPingSharedConfigEnabled())throw new Error('PayPing shared config belum diaktifkan.');
 const client=await getSupportDb(),t=new Date().toISOString(),environment=currentSupportEnvironment();
 await client.execute({sql:"INSERT INTO payping_access_policies_v2(environment,bot_id,mode,updated_at) VALUES(?,'mediax','free',?) ON CONFLICT(environment,bot_id) DO UPDATE SET mode='free',updated_at=excluded.updated_at",args:[environment,t]});
 channelRule.checked=0;channelRule.value=null;
 return {mode:'free'};
}

export async function setMediaXFreeChannelAccessMode(){
 if(!isPayPingSharedConfigEnabled())throw new Error('PayPing shared config belum diaktifkan.');
 const client=await getSupportDb(),environment=currentSupportEnvironment();
 const state=await client.execute({sql:"SELECT p.mode,p.channel_id,c.campaign_seq,c.channel_id campaign_channel_id FROM payping_access_policies_v2 p LEFT JOIN payping_channel_campaign_v2 c ON c.environment=p.environment AND c.bot_id=p.bot_id WHERE p.environment=? AND p.bot_id='mediax' LIMIT 1",args:[environment]});
 const p=state.rows?.[0]||{};
 const configured=String(p.channel_id||'').trim();
 const fallback=String(process.env.REQUIRED_CHANNEL_USERNAME||'').trim();
 const channel=/^@[A-Za-z0-9_]{5,}$/.test(configured)?configured:/^@[A-Za-z0-9_]{5,}$/.test(fallback)?fallback:'';
 if(!channel)throw new Error('Set channel @username dalam PayPing → MediaX → Access Control dahulu.');
 const changed=String(p.mode||'')!=='free_channel'||String(p.campaign_channel_id||'')!==channel||!Number(p.campaign_seq||0);
 const t=new Date().toISOString();
 const statements=[{sql:"INSERT INTO payping_access_policies_v2(environment,bot_id,mode,channel_id,channel_after,updated_at) VALUES(?,'mediax','free_channel',?,1,?) ON CONFLICT(environment,bot_id) DO UPDATE SET mode='free_channel',channel_id=excluded.channel_id,channel_after=1,updated_at=excluded.updated_at",args:[environment,channel,t]}];
 if(changed)statements.push({sql:"INSERT INTO payping_channel_campaign_v2(environment,bot_id,campaign_seq,channel_id,activated_at) VALUES(?,'mediax',1,?,?) ON CONFLICT(environment,bot_id) DO UPDATE SET campaign_seq=payping_channel_campaign_v2.campaign_seq+1,channel_id=excluded.channel_id,activated_at=excluded.activated_at",args:[environment,channel,t]});
 await client.batch(statements,'write');
 channelRule.checked=0;channelRule.value=null;
 return {mode:'free_channel',channel,newCampaign:changed};
}

// Campaign uses are private to Free + Channel, separate from the historical
// Premium HQ count in bot-stats.json and separate from Force Support cycles.
export async function hasMediaXChannelCampaignUse(userId,campaignSequence){
  const id=Number(userId);
  if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(Number(campaignSequence)))return false;
  try{
    const db=await getSupportDb();
    const r=await db.execute({sql:"SELECT 1 FROM payping_channel_campaign_uses_v2 WHERE environment=? AND bot_id='mediax' AND campaign_seq=? AND telegram_user_id=? LIMIT 1",
      args:[currentSupportEnvironment(),campaignSequence,String(id)]});
    return Boolean(r.rows?.length);
  }catch(e){
    console.warn('[payping-shared] channel campaign usage lookup failed:',e.message);
    return false;
  }
}

export async function recordMediaXChannelCampaignUse(userId,source='premium_hq'){
  if(!isPayPingSharedConfigEnabled())return false;
  const id=Number(userId);
  if(!Number.isSafeInteger(id)||id<=0)return false;
  const rule=await getMediaXChannelRule();
  if(!rule?.campaignSequence)return false;
  const db=await getSupportDb(),t=new Date().toISOString();
  try{
    const r=await db.execute({sql:"INSERT OR IGNORE INTO payping_channel_campaign_uses_v2(environment,bot_id,campaign_seq,telegram_user_id,first_success_at,source) SELECT p.environment,'mediax',c.campaign_seq,?,?,? FROM payping_access_policies_v2 p JOIN payping_channel_campaign_v2 c ON c.environment=p.environment AND c.bot_id=p.bot_id LEFT JOIN support_daily_force_mode f ON f.environment=p.environment WHERE p.environment=? AND p.bot_id='mediax' AND p.mode='free_channel' AND p.channel_id=c.channel_id AND c.campaign_seq=? AND COALESCE(f.enabled,0)=0",
      args:[String(id),t,String(source).slice(0,40),currentSupportEnvironment(),rule.campaignSequence]});
    return Number(r.rowsAffected||0)===1;
  }catch(e){
    console.warn('[payping-shared] channel completion save failed:',e.message);
    return false;
  }
}


/** Only the HQ menu/buttons attached to the FIRST delivered media can finish
 * that free session. Later incoming link/gallery messages are still gated.
 * No old download counters or Force Support cycle records are modified.
 */
export async function canFinishMediaXFirstHq(userId,campaignSequence,messageTimestamp){
 const id=Number(userId),seq=Number(campaignSequence),mediaMs=Number(messageTimestamp)*1000;
 if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(seq)||seq<1||!Number.isFinite(mediaMs)||mediaMs<=0)return false;
 try{
  const db=await getSupportDb();
  const r=await db.execute({sql:"SELECT first_success_at,source FROM payping_channel_campaign_uses_v2 WHERE environment=? AND bot_id='mediax' AND campaign_seq=? AND telegram_user_id=? LIMIT 1",
   args:[currentSupportEnvironment(),seq,String(id)]});
  const row=r.rows?.[0];
  if(!row||String(row.source)==='hq_completed')return false;
  const first=Date.parse(String(row.first_success_at||'')),age=Date.now()-first;
  // The source media was sent shortly before the successful download was recorded.
  // Original HQ buttons can finish within 24 hours, but cannot apply to later media.
  return Number.isFinite(first)&&age>=0&&age<86_400_000
   && mediaMs>=first-300_000 && mediaMs<=first+60_000;
 }catch(e){
  console.warn('[payping-shared] first channel HQ verification failed:',e.message);
  return false;
 }
}

export async function completeMediaXFirstHq(userId){
 if(!isPayPingSharedConfigEnabled())return false;
 const id=Number(userId);
 if(!Number.isSafeInteger(id)||id<=0)return false;
 const rule=await getMediaXChannelRule();
 if(!rule?.campaignSequence)return false;
 try{
  const db=await getSupportDb();
  const r=await db.execute({sql:"UPDATE payping_channel_campaign_uses_v2 SET source='hq_completed' WHERE environment=? AND bot_id='mediax' AND campaign_seq=? AND telegram_user_id=? AND source<>'hq_completed'",
   args:[currentSupportEnvironment(),rule.campaignSequence,String(id)]});
  return Number(r.rowsAffected||0)>0;
 }catch(e){
  console.warn('[payping-shared] channel HQ completion failed:',e.message);
  return false;
 }
}
