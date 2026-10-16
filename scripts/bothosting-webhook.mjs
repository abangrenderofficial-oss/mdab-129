// Explicit, idempotent and no-drop Telegram webhook cutover for Bot Hosting.
// Never called by npm install or preflight.
const env=k=>String(process.env[k]||'').trim();
if(env('MEDIAX_BOTHOSTING_ACTIVE')!=='true'||env('MEDIAX_BOTHOSTING_CUTOVER_APPROVED')!=='true')
  throw Error('Webhook cutover blocked. Set BOTHOSTING_ACTIVE and CUTOVER_APPROVED=true only after old Railway instance is stopped.');
const base=new URL(env('PUBLIC_BASE_URL'));
if(base.protocol!=='https:'||base.pathname!=='/'||base.search||base.hash)throw Error('PUBLIC_BASE_URL must be HTTPS origin');
const token=env('TELEGRAM_BOT_TOKEN'),secret=env('TELEGRAM_WEBHOOK_SECRET');
if(!token||!/^[A-Za-z0-9_-]{1,256}$/.test(secret))throw Error('Missing Telegram webhook ENV');
const destination=base.origin+'/api/telegram';
const endpoint='https://api.telegram.org/bot'+token+'/';
async function tg(method,data){
  const response=await fetch(endpoint+method,{
    method:data?'POST':'GET',
    headers:data?{'content-type':'application/json'}:undefined,
    body:data?JSON.stringify(data):undefined,
    signal:AbortSignal.timeout(20000)
  });
  const json=await response.json().catch(()=>({}));
  if(!response.ok||json.ok!==true)throw Error('Telegram '+method+' failed: '+String(json.description||response.status).slice(0,180));
  return json.result;
}
const before=await tg('getWebhookInfo');
if(before.url===destination){console.log('[BOTHOSTING] Webhook already points to this server; no change.');}
else{
  // Do not call drop_pending_updates=true. Do not change the bot token.
  await tg('setWebhook',{url:destination,secret_token:secret,
    allowed_updates:['message','edited_message','callback_query'],drop_pending_updates:false});
  const after=await tg('getWebhookInfo');
  if(after.url!==destination)throw Error('Webhook verification failed after cutover');
  console.log('[BOTHOSTING] Webhook moved to '+destination+' (pending updates preserved).');
}
