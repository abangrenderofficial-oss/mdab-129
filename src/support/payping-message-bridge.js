// Message-only bridge: NEVER writes access policy, usage counters or bot mode.
// MediaX retains its tested Free / Channel / Force gating and original keyboards.
import {currentSupportEnvironment,getSupportDb} from './store.js';
import {isPayPingSharedConfigEnabled} from './payping-shared-config.js';
const escapeHtml=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const allowed=new Set(['b','i','strong','em','u']);
export function formatPayPingMessage(template,values={}){
 const body=String(template||'').replace(/\\n/g,'\n');
 // Escape all user-supplied values; only allow a tiny Telegram HTML formatting subset.
 const safe=body.replace(/\{([a-z_]+)\}/g,(_,key)=>'\u0001'+encodeURIComponent(escapeHtml(values[key]??''))+'\u0002');
 let formatted=escapeHtml(safe).replace(/&lt;(\/?)(b|i|strong|em|u)&gt;/gi,(full,closing,tag)=>allowed.has(tag.toLowerCase())?'<'+closing+tag.toLowerCase()+'>':full);
 formatted=formatted.replace(/\u0001([\s\S]*?)\u0002/g,(_,token)=>decodeURIComponent(token));
 return formatted.slice(0,3900);
}
export async function getMediaXLockCopy(mode,{firstName='',username='',channel=''}={}){
 if(!isPayPingSharedConfigEnabled()||!['free_channel','force_support'].includes(mode))return null;
 try{
  const db=await getSupportDb(),env=currentSupportEnvironment();
  const [saved,bot]=await Promise.all([
   db.execute({sql:"SELECT body,button_enabled,button_label,button_url FROM payping_lock_replies_v1 WHERE environment=? AND bot_id='mediax' AND mode=? LIMIT 1",args:[env,mode]}),
   db.execute({sql:"SELECT name FROM payping_bots WHERE environment=? AND bot_id='mediax' LIMIT 1",args:[env]})
  ]);
  const row=saved.rows?.[0];
  if(!row?.body)return null;
  const values={first_name:String(firstName||'awak').slice(0,80),username:username?'@'+String(username).replace(/^@/,'').slice(0,70):'',bot_name:String(bot.rows?.[0]?.name||'MediaX Downloader'),channel:String(channel||''),mode,support_tier:'',support_status:'Free',date:new Date().toLocaleDateString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}),time:new Date().toLocaleTimeString('en-MY',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit'})};
  return {text:formatPayPingMessage(row.body,values),parse_mode:'HTML',buttonEnabled:Number(row.button_enabled)===1,buttonLabel:String(row.button_label||'').slice(0,64),buttonUrl:String(row.button_url||'').slice(0,900)};
 }catch(e){
  console.warn('[payping-copy] custom message unavailable; preserving existing prompt:',String(e?.message||'error').slice(0,180));
  return null;
 }
}
