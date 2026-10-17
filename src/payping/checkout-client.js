import {currentSupportEnvironment,getSupportDb} from '../support/store.js';
import {proofForRequest,AURORA_ORIGIN} from './aurora-proof.js';

export function isPayPingV2CheckoutSelected(){
  return String(process.env.MEDIAX_PAYMENT_PROVIDER||'legacy').trim().toLowerCase()==='payping';
}
function requireConfig(){
  const base=String(process.env.PAYPING_URL||AURORA_ORIGIN).trim();
  const telegramToken=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
  let url;
  try{url=new URL(base);}catch{}
  if(!url||url.protocol!=='https:'||url.username||url.password||!/^[-a-z0-9.]+$/i.test(url.hostname)||url.pathname!=='/'||url.search||url.hash)throw Object.assign(new Error('Invalid PayPing HTTPS origin'),{code:'PAYPING_URL_INVALID'});
  if(!/^\\d{5,20}:[A-Za-z0-9_-]{30,}$/.test(telegramToken))throw Object.assign(new Error('Telegram Bot Token is required for Aurora AutoConnect'),{code:'PAYPING_TELEGRAM_PROOF_MISSING'});
  return {base:url.origin,botId:'mediax',telegramToken};
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
  const {base,botId,telegramToken}=requireConfig();
  const telegramUserId=String(userId||'').trim();
  if(!/^[0-9]{1,20}$/.test(telegramUserId))throw Object.assign(new Error('Invalid Telegram user ID'),{code:'PAYPING_USER_INVALID'});
  const planId=await activeMediaXPlanForAmount(amount);
  const path='/api/bot-checkout/'+encodeURIComponent(botId)+'/start';
  const raw=JSON.stringify({telegramUserId,telegramUsername:String(username||'').replace(/^@/,'').slice(0,80),planId});
  const proof=proofForRequest({token:telegramToken,identity:botId,method:'POST',path,body:raw});
  const response=await fetchImpl(base+path,{
    method:'POST',headers:{'content-type':'application/json',...proof},
    body:raw,signal:AbortSignal.timeout(12000),redirect:'error'
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload.ok)throw Object.assign(new Error('PayPing checkout temporarily unavailable'),{code:'PAYPING_CHECKOUT_UNAVAILABLE',status:response.status});
  const destination=String(payload.data?.url||'');
  let u;try{u=new URL(destination)}catch{}
  if(!u||u.protocol!=='https:'||u.origin!==base||!/^\/pay\/[a-f0-9]{64}$/.test(u.pathname)||u.search||u.hash)throw Object.assign(new Error('Unexpected PayPing Aurora checkout URL'),{code:'PAYPING_BAD_CHECKOUT_URL'});
  return {url:u.href,planId,expiresAt:payload.data?.expiresAt||null};
}
