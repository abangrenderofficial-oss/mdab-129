// MediaX Bot Hosting compatibility: read PayPing lock text from the SAME Turso,
// but keep MediaX's original working Bayarcash/support callback handlers.
import {currentSupportEnvironment,getSupportDb} from './store.js';
import {isPayPingSharedConfigEnabled} from './payping-shared-config.js';

const MODES=new Set(['free_channel','force_support']);
const cache=new Map();
const CACHE_MS=10000;
function clean(s){return String(s??'').slice(0,3500)}
export function interpolateMediaXLockText(body,{from={},channel=''}={}){
 const date=new Date();
 const vars={
  first_name:String(from?.first_name||from?.firstName||'sahabat').slice(0,90),
  username:from?.username?'@'+String(from.username).replace(/^@/,'').slice(0,80):'',
  bot_name:'MediaX Downloader',channel:String(channel||'').slice(0,100),
  mode:'',support_tier:'',support_status:'Free',
  date:date.toLocaleDateString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}),
  time:date.toLocaleTimeString('en-MY',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit'})
 };
 return clean(body).replace(/\{([a-z_]+)\}/g,(original,key)=>Object.prototype.hasOwnProperty.call(vars,key)?vars[key]:original);
}
/**
 * Returns null when PayPing is disabled, when a custom lock message was not
 * saved, or when its DB is temporarily unavailable. Never changes legacy modes,
 * Telegram webhook or Bayarcash logic.
 */
export async function readMediaXLockReply(mode,{from={},channel=''}={}){
 if(!MODES.has(mode)||!isPayPingSharedConfigEnabled())return null;
 let item=cache.get(mode);
 if(!item||Date.now()-item.time>CACHE_MS){
  try{
   const db=await getSupportDb();
   const result=await db.execute({
    sql:"SELECT body,button_enabled,button_label,button_url FROM payping_lock_replies_v1 WHERE environment=? AND bot_id='mediax' AND mode=? LIMIT 1",
    args:[currentSupportEnvironment(),mode]
   });
   const row=result.rows?.[0]||null;
   item={time:Date.now(),row:row?{
    body:String(row.body||''),buttonEnabled:Number(row.button_enabled||0)===1,
    buttonLabel:String(row.button_label||''),buttonUrl:String(row.button_url||'')
   }:null};
   cache.set(mode,item);
  }catch(error){
   console.warn('[mediax-payping-lock] Read unavailable; using existing safe copy:',error?.message);
   return null;
  }
 }
 if(!item.row?.body)return null;
 return {...item.row,text:interpolateMediaXLockText(item.row.body,{from,channel})};
}
export function resetMediaXLockCache(){cache.clear()}
