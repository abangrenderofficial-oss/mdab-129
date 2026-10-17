import {currentSupportEnvironment,getSupportDb} from '../support/store.js';

export function isPayPingV2CheckoutSelected(){
  return String(process.env.MEDIAX_PAYMENT_PROVIDER||'legacy').trim().toLowerCase()==='payping';
}
function requireConfig(){
  const base=String(process.env.PAYPING_URL||'').trim().replace(/\\/$/,'');
  const botId=String(process.env.PAYPING_BOT_ID||'mediax').trim();
  const apiKey=String(process.env.PAYPING_BOT_API_KEY||'').trim();
  let url;
  try{url=new URL(base);}catch{}
  if(!url||url.protocol!=='https:'||url.username||url.password||!/^[-a-z0-9.]+$/i.test(url.hostname)||url.pathname!=='/'||url.search||url.hash)throw Object.assign(new Error('Invalid PayPing HTTPS origin'),{code:'PAYPING_URL_INVALID'});
  if(botId!=='mediax')throw Object.assign(new Error('MediaX bot ID must remain mediax'),{code:'PAYPING_BOT_ID_INVALID'});
  if(!/^ppk_[A-Za-z0-9_-]{32,}$/.test(apiKey))throw Object.assign(new Error('PayPing bot API key missing or invalid'),{code:'PAYPING_KEY_MISSING'});
  return {base:url.origin,botId,apiKey};
}
/** Resolves editable support plans from canonical Turso, without relying on fixed RM amount mapping. */
export async function activeMediaXPlanForAmount(amount){
  const cents=Math.round(Number(amount)*100);
  if(!Number.isSafeInteger(cents)||cents<100)throw Object.assign(new Error('Invalid support amount'),{code:'PAYPING_INVALID_AMOUNT'});
  const db=await getSupportDb();
  const out=await db.execute({sql:"SELECT plan_id FROM payping_plans WHERE environment=? AND bot_id='mediax' AND status='active' AND amount_cents=? LIMIT 2",args:[currentSupportEnvironment(),cents]});
  if(out.rows?.length!==1)throw Object.assign(new Error('PayPing active plan unavailable or duplicate'),{code:'PAYPING_PLAN_UNAVAILABLE'});
  return String(out.rows[0].plan_id);
}
/** Creates a short-lived PayPing hosted form link; MediaX never receives payment credentials. */
export async function prepareMediaXPayPingCheckout({userId,username='',amount},fetchImpl=fetch){
  const {base,botId,apiKey}=requireConfig();
  const telegramUserId=String(userId||'').trim();
  if(!/^\\d{1,20}$/.test(telegramUserId))throw Object.assign(new Error('Invalid Telegram user ID'),{code:'PAYPING_USER_INVALID'});
  const planId=await activeMediaXPlanForAmount(amount);
  const response=await fetchImpl(base+'/api/bot-checkout/'+encodeURIComponent(botId)+'/prepare',{
    method:'POST',headers:{'content-type':'application/json','x-payping-bot-key':apiKey},
    body:JSON.stringify({telegramUserId,telegramUsername:String(username||'').replace(/^@/,'').slice(0,80),planId}),
    signal:AbortSignal.timeout(12000),redirect:'error'
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload.ok)throw Object.assign(new Error('PayPing checkout temporarily unavailable'),{code:'PAYPING_CHECKOUT_UNAVAILABLE',status:response.status});
  const destination=String(payload.data?.url||'');
  let u;try{u=new URL(destination)}catch{}
  if(!u||u.protocol!=='https:'||u.origin!==base||u.pathname!=='/api/payments/start'||!u.searchParams.has('ticket'))throw Object.assign(new Error('Unexpected PayPing checkout URL'),{code:'PAYPING_BAD_CHECKOUT_URL'});
  return {url:u.href,planId,expiresAt:payload.data?.expiresAt||null};
}
