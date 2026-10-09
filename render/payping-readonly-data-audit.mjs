// Read-only Turso summary. No data rows, tokens, email addresses or user IDs
// are logged or returned. Useful to ensure Render can see existing PayPing data.
import { createClient } from '@libsql/client';
import { createECDH } from 'node:crypto';

const url=String(process.env.TURSO_DATABASE_URL||'').trim();
const authToken=String(process.env.TURSO_AUTH_TOKEN||'').trim();
const env=String(process.env.BAYARCASH_SANDBOX||'').toLowerCase()==='true'
  ? 'sandbox' : 'production';
const tables=[
  ['accounts','payping_accounts',false],
  ['bots','payping_bots',true],
  ['payments','support_orders',true],
  ['transactions','support_transactions',true],
  ['affiliates','affiliate_profiles',true],
  ['pushSubscriptions','support_push_subscriptions',true],
  ['dailyStats','payping_daily_stats',true],
];
const results={};
let configured=Boolean(url&&authToken);
let readable=false;
if(configured){
  const db=createClient({url,authToken});
  try{
    for(const [label,table,hasEnvironment] of tables){
      try{
        const result=await db.execute({
          sql:'SELECT COUNT(*) AS n FROM '+table+(hasEnvironment?' WHERE environment = ?':''),
          args:hasEnvironment?[env]:[],
        });
        results[label]=Number(result.rows?.[0]?.n||0);
      }catch{
        results[label]=null;
      }
    }
    readable=Object.values(results).every(x=>Number.isSafeInteger(x));
  }finally{
    try{db.close()}catch{}
  }
}
let validVapidPair=false;
try{
  const pub=String(process.env.WEBPUSH_VAPID_PUBLIC_KEY||'').trim();
  const priv=String(process.env.WEBPUSH_VAPID_PRIVATE_KEY||'').trim();
  if(pub && priv){
    const signer=createECDH('prime256v1');
    signer.setPrivateKey(Buffer.from(priv,'base64url'));
    validVapidPair=signer.getPublicKey(undefined,'uncompressed').toString('base64url')===pub;
  }
}catch{
  validVapidPair=false;
}
console.log('MEDIAX_RENDER_PAYPING_PUSH_KEYPAIR',JSON.stringify({
  configured:Boolean(process.env.WEBPUSH_VAPID_PUBLIC_KEY&&process.env.WEBPUSH_VAPID_PRIVATE_KEY),
  validVapidPair,
  note:'Cryptographic keypair self-check only; real push delivery and origin migration still pending',
}));

console.log('MEDIAX_RENDER_PAYPING_DB_READINESS',JSON.stringify({
  configured,readable,environment:env,counts:results,
  note:'Read-only aggregate snapshot. Counts do not establish Vercel parity or verified logins/payments',
}));
