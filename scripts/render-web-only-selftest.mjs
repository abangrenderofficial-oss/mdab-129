import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const port = 37993;
const base = 'http://127.0.0.1:' + port;
const env = {...process.env, PORT:String(port), MEDIAX_MODE:'web_only',
  MEDIAX_FAILOVER_APPROVED:'NO', MEDIAX_STATS_BACKEND:'file'};
for(const secret of ['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','BAYARCASH_API_SECRET_KEY',
  'BAYARCASH_API_TOKEN','BAYARCASH_PORTAL_KEY','GITHUB_ACTIONS_TOKEN',
  'TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','SETUP_SECRET']) delete env[secret];
const child = spawn(process.execPath,['server.js'], {env,stdio:['ignore','pipe','pipe']});
let log = '';
child.stdout.on('data',b => {log+=b.toString().slice(0,2000);});
child.stderr.on('data',b => {log+=b.toString().slice(0,2000);});
async function request(path,options={}) {
  const r=await fetch(base+path, {...options,signal:AbortSignal.timeout(6000)});
  return {status:r.status,headers:r.headers,body:await r.text()};
}
try {
  let started=false;
  for(let i=0;i<60;i++){
    try{const r=await request('/');if(r.status===200){started=true;break;}}catch{}
    if(child.exitCode!==null)break;
    await delay(250);
  }
  assert.ok(started,'web-only Node server failed startup: '+log.slice(-500));
  const pages=[
    ['/ar-payment/', 'PayPing!'],
    ['/ar-payment/bots', 'Bots'],
    ['/ar-payment/bots/add','Connect New Bot'],
    ['/ar-payment/bots/add/','Connect New Bot'],
    ['/ar-payment/transactions','Transactions'],
    ['/ar-payment/settings','Settings'],
    ['/ar-payment/affiliate','Affiliate'],
    ['/ar-payment/payping-v4.webmanifest','PayPing!'],
    ['/ar-payment/sw.js','self'],
  ];
  for(const [path,pattern] of pages){
    const r=await request(path);
    assert.equal(r.status,200,'web page missing '+path+' (response '+r.body.slice(0,120)+')');
    assert.ok(r.body.toLowerCase().includes(pattern.toLowerCase()),'wrong payload '+path);
  }
  const locked=await request('/api/payping-bot-admin',{
    method:'POST',headers:{'content-type':'application/json'},body:'{"action":"create_bot"}',
  });
  assert.equal(locked.status,503,'unverified bot encryption must lock admin writes');
  const limit=await request('/api/heavy-limit');
  assert.equal(limit.status,200);
  assert.equal(JSON.parse(limit.body).heavy_video_limit_mb,200);
  const health=await request('/healthz');
  assert.equal(health.status,200);
  assert.equal(JSON.parse(health.body).telegramWebhookActive,false);
  const blocked=[
    ['/api/telegram',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}],
    ['/api/setup-webhook',{method:'GET'}],
    ['/api/bayarcash',{method:'POST',body:'{}'}],
    ['/api/support-checkout',{method:'POST',body:'{}'}],
    ['/api/premium-hq-success',{method:'POST',body:'{}'}],
    ['/api/media',{method:'POST',body:'{}'}],
  ];
  for(const [path,opt] of blocked){
    const r=await request(path,opt);
    assert.equal(r.status,503,'web-only must reject '+path);
  }
  assert.ok(!log.includes('[support-monitor]'), 'web-only unexpectedly started bot monitor');
  assert.ok(!log.includes('[content-bridge] retry scheduler started'), 'web-only started content-bridge retry');
  assert.ok(!log.includes('[daily-force] startup'), 'web-only started force support scheduler');
  console.log('MEDIAX_RENDER_WEB_ONLY_SELFTEST_OK — PayPing pages/API, no Telegram webhook, no bot timers, no gateway callback');
} finally {
  child.kill('SIGTERM');
  await Promise.race([once(child,'exit'),delay(2000)]).catch(()=>{});
}
