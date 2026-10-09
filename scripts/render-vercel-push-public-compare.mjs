import assert from 'node:assert/strict';

// Vercel production public VAPID key, inspected via the project's owned ENV
// API because the Vercel HTTP endpoint currently returns 503. This is
// a fingerprint of a PUBLIC key, never the VAPID private key.
const oldPublic={length:87,fnv64:'bcf9a5270503d54c'};
function publicFingerprint(value) {
  let h=0xcbf29ce484222325n;
  for(let i=0;i<value.length;i++){
    h=((h^BigInt(value.charCodeAt(i)))*0x100000001b3n)&0xffffffffffffffffn;
  }
  return {length:value.length,fnv64:h.toString(16).padStart(16,'0')};
}
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
const matchOld=Boolean(render?.publicKey &&
  publicFingerprint(render.publicKey).length===oldPublic.length &&
  publicFingerprint(render.publicKey).fnv64===oldPublic.fnv64);
const sameKey=comparable?render.publicKey===vercel.publicKey:matchOld;
const comparisonSource=comparable?'live-vercel-api':'vercel-production-public-env-fingerprint';
console.log('MEDIAX_RENDER_VERCEL_PUSH_PARITY',JSON.stringify({
  renderStatus:render.httpStatus,
  renderConfigured:render.configured,
  vercelStatus:vercel.httpStatus,
  vercelConfigured:vercel.configured,
  samePublicKey:sameKey,
  comparisonSource,
  migrationReady:render.configured&&sameKey,
  caveat:'A matching VAPID key is necessary but cannot migrate origin-bound service workers, cookies or existing PWA installs',
}));
assert.equal(render.httpStatus,200,'Render Push API is not live');
assert.equal(render.configured,true,'Render push VAPID configuration missing');
assert.equal(sameKey,true,'Render and Vercel production VAPID public keys do not match');
