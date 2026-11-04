// MediaX → PayPing: report a /start ref_AR… opened from a PayPing affiliate link.
// PayPing owns the referral: it checks the code, blocks self-referral, records the join once
// and tells the affiliate. Signed with the bot token MediaX already has (same as checkout).
import {proofForRequest,AURORA_ORIGIN} from './aurora-proof.js';

const PAYPING_CODE=/^AR[A-F0-9]{12}$/;

/** "ref_ar1234…" → "AR1234…", or '' when it is not a PayPing affiliate code. */
export function paypingReferralCode(payload){
  const code=String(payload||'').trim().replace(/^ref[_-]?/i,'').toUpperCase();
  return PAYPING_CODE.test(code)?code:'';
}

export function config(){
  const base=String(process.env.PAYPING_URL||AURORA_ORIGIN).trim();
  const token=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();
  let url;try{url=new URL(base)}catch{}
  if(!url||url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Object.assign(new Error('Invalid PayPing HTTPS origin'),{code:'PAYPING_ORIGIN_INVALID'});
  if(!/^\d{5,20}:[A-Za-z0-9_-]{30,}$/.test(token))throw Object.assign(new Error('Telegram Bot Token is required for PayPing'),{code:'PAYPING_TELEGRAM_PROOF_MISSING'});
  return {base:url.origin,token,botId:'mediax'};
}

/** Returns PayPing's answer, e.g. {recorded:true} or {recorded:false,reason:'self_referral'}. */
export async function reportPayPingReferral({userId,payload,messageId,date},fetchImpl=fetch){
  const code=paypingReferralCode(payload);
  const telegramUserId=String(userId||'').trim();
  if(!code||!/^\d{1,20}$/.test(telegramUserId))return {recorded:false,reason:'not_payping_code'};
  const {base,token,botId}=config();
  const path='/api/bot-referrals/'+encodeURIComponent(botId)+'/join';
  const eventId=('tgstart:'+telegramUserId+':'+String(messageId||date||Date.now())).replace(/[^-_A-Za-z0-9:.]/g,'').slice(0,120);
  const raw=JSON.stringify({telegramUserId,referralCode:code,eventId});
  const proof=proofForRequest({token,identity:botId,method:'POST',path,body:raw});
  const res=await fetchImpl(base+path,{method:'POST',headers:{'content-type':'application/json',...proof},body:raw,signal:AbortSignal.timeout(10000),redirect:'error'});
  const out=await res.json().catch(()=>({}));
  if(!res.ok||!out.ok)throw Object.assign(new Error('PayPing referral not recorded'),{code:'PAYPING_REFERRAL_FAILED',status:res.status});
  return out.data||{recorded:false};
}
