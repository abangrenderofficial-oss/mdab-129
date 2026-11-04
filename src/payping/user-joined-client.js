// MediaX → PayPing: a person started MediaX for the first time. PayPing shows the owner
// "New User Joined MediaX! 🎉" with @username, else the name, else the Telegram ID with the last 3 digits hidden.
// Signed with the bot token MediaX already has (same as checkout and referrals). PayPing announces each person once.
import {proofForRequest} from './aurora-proof.js';
import {config} from './referral-client.js';

export async function reportPayPingUserJoined(from={},fetchImpl=fetch){
  const telegramUserId=String(from?.id||'').trim();
  if(!/^\d{1,20}$/.test(telegramUserId)||from?.is_bot)return {announced:false,reason:'not_a_person'};
  const {base,token,botId}=config();
  const path='/api/bot-runtime/'+encodeURIComponent(botId)+'/user-joined';
  const raw=JSON.stringify({telegramUserId,username:String(from.username||'').slice(0,64),firstName:String(from.first_name||'').slice(0,80),lastName:String(from.last_name||'').slice(0,80)});
  const proof=proofForRequest({token,identity:botId,method:'POST',path,body:raw});
  const res=await fetchImpl(base+path,{method:'POST',headers:{'content-type':'application/json',...proof},body:raw,signal:AbortSignal.timeout(10000),redirect:'error'});
  const out=await res.json().catch(()=>({}));
  if(!res.ok||!out.ok)throw Object.assign(new Error('PayPing new-user notice not sent'),{code:'PAYPING_JOIN_FAILED',status:res.status});
  return out.data||{announced:false};
}
