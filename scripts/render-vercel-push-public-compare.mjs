import assert from 'node:assert/strict';

const endpoints=[
  ['render','https://mediax-railway-backup.onrender.com/api/payment-push'],
  ['vercel','https://mdab-129.vercel.app/api/payment-push'],
];
const results=[];
for(const [name,url] of endpoints){
  try{
    const r=await fetch(url,{signal:AbortSignal.timeout(16000),redirect:'manual'});
    const body=(r.headers.get('content-type')||'').includes('json')?await r.json():null;
    results.push({
      name,httpStatus:r.status,
      configured:body?.configured===true,
      publicKey: typeof body?.publicKey==='string'?body.publicKey:'',
    });
  }catch(e){
    results.push({name,httpStatus:0,configured:false,publicKey:'',error:String(e?.name||'fetch_failed')});
  }
}
const render=results.find(x=>x.name==='render');
const vercel=results.find(x=>x.name==='vercel');
const comparable=Boolean(render?.publicKey&&vercel?.publicKey&&render.httpStatus===200&&vercel.httpStatus===200);
const sameKey=comparable?render.publicKey===vercel.publicKey:null;
console.log('MEDIAX_RENDER_VERCEL_PUSH_PARITY',JSON.stringify({
  renderStatus:render.httpStatus,
  renderConfigured:render.configured,
  vercelStatus:vercel.httpStatus,
  vercelConfigured:vercel.configured,
  samePublicKey:sameKey,
  migrationReady:comparable&&sameKey,
  caveat:'A matching VAPID key is necessary but cannot migrate origin-bound service workers, cookies or existing PWA installs',
}));
assert.equal(render.httpStatus,200,'Render Push API is not live');
assert.equal(render.configured,true,'Render push VAPID configuration missing');
if(comparable)assert.equal(sameKey,true,'Render and Vercel VAPID keys do not match');
