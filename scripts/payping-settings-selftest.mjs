import { unlink } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import webpush from 'web-push';

const dbPath=`/tmp/payping-settings-selftest-${process.pid}.db`;
await unlink(dbPath).catch(()=>{});
process.env.TURSO_DATABASE_URL=`file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN='local-selftest';
process.env.BAYARCASH_SANDBOX='true';
const vapid=webpush.generateVAPIDKeys();
process.env.WEBPUSH_VAPID_PUBLIC_KEY=vapid.publicKey;
process.env.WEBPUSH_VAPID_PRIVATE_KEY=vapid.privateKey;
process.env.WEBPUSH_VAPID_SUBJECT='mailto:test@example.com';

const {
  createPushSetupCode,
  registerPushSubscription,
  getPushDeviceContext,
  getPushNotificationHistory,
  revokePushDevice,
  disconnectPushDevice,
} = await import('../src/support/webpush-payment.js');
const { getSupportDb, currentSupportEnvironment } = await import('../src/support/store.js');

function assert(v,m){if(!v)throw new Error(m)}
async function register(owner,endpoint){
  const setup=await createPushSetupCode(owner);
  return registerPushSubscription(setup.code,{
    endpoint,
    keys:{p256dh:'test-p256dh',auth:'test-auth'},
  });
}

const a1=await register('700001','https://push.example.com/device-a1');
const a2=await register('700001','https://push.example.com/device-a2');
const b1=await register('700002','https://push.example.com/device-b1');

const ctxA=await getPushDeviceContext(a1.deviceToken);
const ctxB=await getPushDeviceContext(b1.deviceToken);
assert(ctxA?.ownerUserId==='700001','owner A context missing');
assert(ctxA.activeDeviceCount===2,'owner A should have two active devices');
assert(ctxB?.ownerUserId==='700002','owner B context missing');
const aCurrent=ctxA.currentDeviceId;
const aOther=ctxA.devices.find(x=>!x.current&&x.active)?.id;
const bDevice=ctxB.currentDeviceId;
assert(aCurrent&&aOther&&bDevice,'device ids missing');

const db=await getSupportDb();
const env=currentSupportEnvironment();
const now=new Date().toISOString();
await db.batch([
  {sql:`INSERT INTO support_webpush_delivery(environment,delivery_key,endpoint_hash,status,last_error,updated_at)
        VALUES(?,?,?,'SENT','',?)`,args:[env,'order:A-1',aCurrent,now]},
  {sql:`INSERT INTO support_webpush_delivery(environment,delivery_key,endpoint_hash,status,last_error,updated_at)
        VALUES(?,?,?,'FAILED','network_test',?)`,args:[env,'order:A-2',aOther,now]},
  {sql:`INSERT INTO support_webpush_delivery(environment,delivery_key,endpoint_hash,status,last_error,updated_at)
        VALUES(?,?,?,'SENT','',?)`,args:[env,'order:B-1',bDevice,now]},
], 'write');

const historyA=await getPushNotificationHistory(a1.deviceToken,20);
assert(historyA.length===2,'owner A history must only include two owner A deliveries');
assert(historyA.every(x=>x.deliveryKey!=='order:B-1'),'notification history leaked owner B');

let crossOwnerBlocked=false;
try{await revokePushDevice(a1.deviceToken,bDevice)}catch(error){crossOwnerBlocked=error?.code==='PUSH_DEVICE_NOT_FOUND'}
assert(crossOwnerBlocked,'cross-owner device revoke must be blocked');

const revoke=await revokePushDevice(a1.deviceToken,aOther);
assert(revoke.disconnected===true&&revoke.currentDevice===false,'own secondary device revoke failed');
const afterRevoke=await getPushDeviceContext(a1.deviceToken);
assert(afterRevoke.activeDeviceCount===1,'active device count should fall to one');

await disconnectPushDevice(a1.deviceToken);
const afterDisconnect=await getPushDeviceContext(a1.deviceToken);
assert(afterDisconnect===null,'current device should be unauthenticated after disconnect');

const [api,notifications,settings,home,tx,affiliate,server,router,vercel]=await Promise.all([
  readFile('handlers/payping-settings.js','utf8'),
  readFile('handlers/payping-notifications-pwa.js','utf8'),
  readFile('handlers/payping-settings-pwa.js','utf8'),
  readFile('handlers/payping-home-pwa.js','utf8'),
  readFile('handlers/payping-transactions-pwa.js','utf8'),
  readFile('handlers/affiliate-pwa.js','utf8'),
  readFile('server.js','utf8'),
  readFile('api/router.js','utf8'),
  readFile('vercel.json','utf8'),
]);
const must=(s,m,l)=>{if(!s.includes(m))throw new Error(`${l} missing ${m}`)};
must(api,'getPushNotificationHistory','notification history API');
must(api,"action==='disconnect_current'",'current disconnect action');
must(api,"action==='revoke_device'",'revoke device action');
must(notifications,'Delivery History','notifications page');
must(notifications,"action:'test_notification'",'test notification UI');
must(settings,'Devices & Sessions','settings devices');
must(settings,"action:'disconnect_current'",'settings current disconnect');
must(settings,"action:'revoke_device'",'settings revoke');
must(home,'/ar-payment/notifications','home notifications quick action');
must(home,'/ar-payment/settings','home settings navigation');
must(tx,'/ar-payment/settings','transactions settings tab');
must(affiliate,'/ar-payment/settings','affiliate settings tab');
must(server,"['/api/payping-settings', payPingSettingsHandler]",'Node settings API route');
must(server,"['/ar-payment/notifications', payPingNotificationsPage]",'Node notifications route');
must(server,"['/ar-payment/settings', payPingSettingsPage]",'Node settings route');
must(router,"['payping-settings', payPingSettingsHandler]",'Vercel settings API route');
must(router,"['payping-notifications-page', payPingNotificationsPage]",'Vercel notifications page route');
must(router,"['payping-settings-page', payPingSettingsPage]",'Vercel settings page route');
const cfg=JSON.parse(vercel);
for(const source of ['/api/payping-settings','/ar-payment/notifications','/ar-payment/settings']){
  if(!cfg.rewrites.some(x=>x.source===source))throw new Error(`Vercel rewrite missing ${source}`);
}

console.log('PAYPING_SETTINGS_SELFTEST_OK',JSON.stringify({
  ownerAHistory:historyA.length,
  crossOwnerBlocked,
  activeAfterRevoke:afterRevoke.activeDeviceCount,
}));
