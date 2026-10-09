import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const base='https://mediax-railway-backup.onrender.com';
async function probe(path, method='GET', body='') {
  const response=await fetch(base+path,{
    method,
    headers:method==='POST'?{'content-type':'application/json'}:{},
    body:method==='POST'?body:undefined,
    signal:AbortSignal.timeout(16000),
    redirect:'manual',
  });
  return {status:response.status,type:response.headers.get('content-type')||'',text:await response.text()};
}
let ready=false;
for(let i=0;i<35;i++){
  try {
    const v=await probe('/healthz');
    if(v.status===200&&JSON.parse(v.text).mode==='web_only'){
      ready=true;
      break;
    }
  } catch {}
  await delay(7000);
}
assert.ok(ready,'Render web-only live health did not come up within deadline');
const checks=[
  ['/ar-payment/', 'PayPing!'],
  ['/ar-payment/bots','Bots'],
  ['/ar-payment/bots/add','Connect New Bot'],
  ['/ar-payment/bots/add/','Connect New Bot'],
  ['/ar-payment/transactions','Transactions'],
  ['/ar-payment/settings','Settings'],
  ['/ar-payment/payping-v4.webmanifest','PayPing!'],
  ['/ar-payment/sw.js','self'],
];
for(const [path,needle] of checks){
  const r=await probe(path);
  assert.equal(r.status,200,'live page returned '+r.status+' at '+path);
  assert.ok(r.text.toLowerCase().includes(needle.toLowerCase()),'live page content mismatch '+path);
}
const api=await probe('/api/heavy-limit');
assert.equal(api.status,200);
assert.equal(JSON.parse(api.text).heavy_video_limit_mb,200);
const blocked=[
  ['/api/telegram','POST'],
  ['/api/bayarcash','POST'],
  ['/api/premium-hq-success','POST'],
  ['/api/setup-webhook','GET'],
  ['/api/support-checkout','POST'],
];
for(const [path,method] of blocked){
  const p=await probe(path,method,method==='POST'?'{}':'');
  assert.equal(p.status,503,'bot/gateway route unexpectedly enabled: '+path);
}
const owner=await probe('/api/payping-bot-admin','POST','{"action":"pause_bot","botId":"mediax"}');
assert.equal(owner.status,503,'bot-admin writes must be disabled until encrypted credentials migrate');
const session=await probe('/api/payping-auth');
assert.equal(session.status,401,'unauthenticated PayPing session must be denied');
console.log('MEDIAX_RENDER_LIVE_WEB_PARITY_OK '+JSON.stringify({
  pagesPassed:checks.length,apiVerified:true,
  ownerWritesLocked:true,loginProtected:true,
  telegramWebhookDisabled:true,gatewaysDisabled:true,
  note:'Unauthenticated live smoke only; payment/noti/webpush/subscription real user migration still pending',
}));
