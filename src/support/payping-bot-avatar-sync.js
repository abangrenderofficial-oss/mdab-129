import {getSupportDb,currentSupportEnvironment} from './store.js';

const MAX_IMAGE_BYTES=240000;
const API='https://api.telegram.org';
const PERIOD_MS=6*60*60*1000;
let pending=null;
async function telegramCall(token,method,payload){
 const response=await fetch(API+'/bot'+encodeURIComponent(token)+'/'+method,{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify(payload||{}),signal:AbortSignal.timeout(12000),
 });
 if(!response.ok)throw Error('Telegram API failed: '+method+' HTTP '+response.status);
 const data=await response.json();
 if(!data?.ok)throw Error('Telegram API rejected '+method);
 return data.result;
}
export async function refreshMediaXTelegramAvatar(){
 if(pending)return pending;
 pending=(async()=>{
  const token=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
  if(!/^\d{6,15}:[A-Za-z0-9_-]{20,}$/.test(token))return {updated:false,reason:'bot token unavailable'};
  const db=await getSupportDb(),env=currentSupportEnvironment();
  const present=await db.execute({sql:"SELECT bot_id FROM payping_bots WHERE environment=? AND bot_id='mediax' LIMIT 1",args:[env]});
  if(!present.rows?.length)return {updated:false,reason:'PayPing MediaX record missing'};
  const me=await telegramCall(token,'getMe',{});
  if(!me?.is_bot||!Number.isSafeInteger(Number(me.id)))return {updated:false,reason:'Telegram bot identity unavailable'};
  let sizes=[];
  try{
    const photos=await telegramCall(token,'getUserProfilePhotos',{user_id:me.id,limit:1});
    sizes=photos?.photos?.[0]||[];
  }catch{
    // Even if Telegram disallows querying own bot's profile photos, update
    // the canonical username for the public Telegram avatar fallback.
    console.warn('[payping-avatar] Telegram photo lookup unavailable; using username fallback');
  }
  let dataUrl='';
  if(sizes.length){
    const photo=sizes[sizes.length-1];
    const file=await telegramCall(token,'getFile',{file_id:photo.file_id});
    const path=String(file?.file_path||'');
    if(!/^[A-Za-z0-9_./-]+$/.test(path)||path.includes('..'))throw Error('Invalid Telegram file path');
    const response=await fetch(API+'/file/bot'+encodeURIComponent(token)+'/'+path,{signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('Telegram image fetch failed HTTP '+response.status);
    const mime=String(response.headers.get('content-type')||'').toLowerCase().split(';')[0];
    if(!['image/jpeg','image/png'].includes(mime))throw Error('Unsupported Telegram image format');
    if(Number(response.headers.get('content-length')||0)>MAX_IMAGE_BYTES)throw Error('Telegram avatar exceeds maximum size');
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>MAX_IMAGE_BYTES)throw Error('Telegram avatar exceeds maximum size');
    dataUrl='data:'+mime+';base64,'+bytes.toString('base64');
  }
  const now=new Date().toISOString();
  await db.execute({sql:"INSERT INTO payping_bot_secrets(environment,bot_id,telegram_avatar_data_url,created_at,updated_at) VALUES(?,'mediax',?,?,?) ON CONFLICT(environment,bot_id) DO UPDATE SET telegram_avatar_data_url=excluded.telegram_avatar_data_url,updated_at=excluded.updated_at",args:[env,dataUrl,now,now]});
  await db.execute({sql:"UPDATE payping_bots SET telegram_bot_id=?,telegram_username=?,updated_at=? WHERE environment=? AND bot_id='mediax'",args:[String(me.id),String(me.username||''),now,env]});
  return {updated:true,hasAvatar:Boolean(dataUrl)};
 })().finally(()=>{pending=null});
 return pending;
}
// One low-priority background task independent of downloads, HQ, and billing.
export function startMediaXTelegramAvatarSync(){
 void refreshMediaXTelegramAvatar().then(result=>console.log('[payping-avatar] MediaX',result)).catch(e=>console.warn('[payping-avatar] MediaX sync unavailable:',e.message));
 setInterval(()=>void refreshMediaXTelegramAvatar().catch(e=>console.warn('[payping-avatar] MediaX refresh failed:',e.message)),PERIOD_MS).unref();
}
