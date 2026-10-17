// Shared PayPing Aurora AutoConnect proof protocol. No per-bot API key ENV.
// Uses the Telegram Bot Token MediaX already needs to run itself.
import {createHash,createHmac,randomBytes} from 'node:crypto';
export const AURORA_ORIGIN='https://payping-v2-aurora.onrender.com';
export function proofForRequest({token,identity,method,path,body='',timestamp,nonce}){
 if(!/^\d{5,20}:[A-Za-z0-9_-]{30,}$/.test(String(token||'')))throw new Error('TELEGRAM_BOT_TOKEN required');
 if(!/^[a-z0-9][a-z0-9_-]{1,48}$/.test(String(identity||'')))throw new Error('PayPing bot ID invalid');
 if(!['GET','POST'].includes(method)||!/^\/api\/[a-zA-Z0-9/_-]+$/.test(path))throw new Error('Invalid Aurora API route');
 const time=String(timestamp??Math.floor(Date.now()/1000));
 const n=String(nonce??randomBytes(16).toString('hex'));
 if(!/^\d{10}$/.test(time)||!(/^[a-f0-9]{32}$/.test(n)))throw new Error('Bad Aurora proof time/nonce');
 const digest=createHash('sha256').update(String(body),'utf8').digest('hex');
 const canonical=['payping-bot-proof-v1',identity,method,path,time,n,digest].join('\n');
 return {'x-payping-proof-v1':createHmac('sha256',token).update(canonical).digest('hex'),'x-payping-proof-time':time,'x-payping-proof-nonce':n};
}
