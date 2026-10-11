import { unlink, readFile } from 'node:fs/promises';

const dbPath=`/tmp/payment-followup-selftest-${process.pid}.db`;
await unlink(dbPath).catch(()=>{});
process.env.TURSO_DATABASE_URL=`file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN='local-selftest';
process.env.BAYARCASH_SANDBOX='true';

const {
  createPendingSupport,
  markSupportIntentCreated,
} = await import('../src/support/store.js');
const {
  createSupportSubmission,
  markSupportSubmissionCheckout,
} = await import('../src/support/submissions.js');
const {
  ensureAffiliateProfile,
  lockAffiliateReferral,
} = await import('../src/affiliate/store.js');
const {
  classifyPaymentStage,
  autoFollowupRollout,
  runPaymentFollowupCycle,
  getPaymentFollowupInfo,
  stopPaymentFollowup,
  cancelPaymentFollowupByUser,
  sendPaymentFollowup,
} = await import('../src/support/payment-followup.js');

function assert(value,message){if(!value)throw new Error(message)}
function must(source,needle,label){if(!source.includes(needle))throw new Error(`${label} missing ${needle}`)}

assert(classifyPaymentStage({orderStatus:'PENDING'})==='CHECKOUT_PENDING','checkout stage failed');
assert(classifyPaymentStage({orderStatus:'PENDING',gatewayStatus:'1'})==='PAYMENT_PENDING','gateway pending stage failed');
assert(classifyPaymentStage({orderStatus:'PENDING',followupState:'REVIEW'})==='PAYMENT_REVIEW','review stage failed');
assert(classifyPaymentStage({orderStatus:'PAID'})==='PAID','paid stage failed');

const order='SUP-FOLLOWUP-SELFTEST-A';
const userId='123456789';
await createSupportSubmission({
  orderNumber:order,
  userId,
  username:'followup_test',
  amount:10,
  tierKey:'supporter',
  tierLabel:'🤍 Supporter',
});
await createPendingSupport({orderNumber:order,userId,username:'followup_test',amount:10});
await markSupportIntentCreated(order,'pi_followup_selftest');
await markSupportSubmissionCheckout(order,'https://example.test/pay','pi_followup_selftest');

await ensureAffiliateProfile({userId:'999888777',username:'affiliate_test'});
const refProfile=await ensureAffiliateProfile({userId:'999888777',username:'affiliate_test'});
await lockAffiliateReferral({userId,username:'followup_test',referralCode:refProfile.referralCode});
const info=await getPaymentFollowupInfo(order);
const affiliateInfo=await getPaymentFollowupInfo(order,{viewerRole:'affiliate',viewerUserId:'999888777'});
assert(info?.state==='ACTIVE','new followup should be active');
assert(info?.stage==='CHECKOUT_PENDING','new checkout should classify checkout pending');
assert(info?.followupCount===0,'new followup count should be zero');
assert(info?.paymentUrlAvailable===true,'payment URL should be available');
const activation=await autoFollowupRollout();
assert(activation.enabled===false,'automatic MediaX follow-up must remain permanently disabled');
let automaticDenied=false;
try{await sendPaymentFollowup(order,{manual:false});}catch(e){automaticDenied=e.code==='PAYMENT_FOLLOWUP_FORBIDDEN';}
assert(automaticDenied,'direct automatic Telegram follow-up must be rejected');
let affiliateDenied=false;
try{await sendPaymentFollowup(order,{manual:true,actorRole:'affiliate',actorUserId:'999888777'});}catch(e){affiliateDenied=e.code==='PAYMENT_FOLLOWUP_FORBIDDEN';}
assert(affiliateDenied,'affiliate follow-up must be rejected');
const legacyBacklog=await runPaymentFollowupCycle();
assert(legacyBacklog.sent===0,'manual-only cycle must send no Telegram messages');
assert(legacyBacklog.reason==='manual_only','automatic scheduler must be inert');
assert(legacyBacklog.candidates===0,'existing checkout must not enter new auto follow-up rollout');

assert(info?.nextFollowupAt===null,'owner follow-up must be manual-only with no automatic next follow-up');
assert(info?.maxFollowups===1,'admin follow-up must cap at one');
assert(affiliateInfo?.followupCount===0,'affiliate followup count should start at zero');
assert(affiliateInfo?.maxFollowups===1,'legacy affiliate quota cannot exceed one');
assert(affiliateInfo?.cooldownHours===8,'affiliate followup cooldown should be 8 hours');

const stopped=await stopPaymentFollowup(order,'SELFTEST_STOP');
assert(stopped?.state==='STOPPED','owner stop state failed');
assert(stopped?.stoppedReason==='SELFTEST_STOP','owner stop reason failed');

const order2='SUP-FOLLOWUP-SELFTEST-B';
await createSupportSubmission({
  orderNumber:order2,
  userId,
  username:'followup_test',
  amount:10,
  tierKey:'supporter',
  tierLabel:'🤍 Supporter',
});
await createPendingSupport({orderNumber:order2,userId,username:'followup_test',amount:10});
await markSupportIntentCreated(order2,'pi_followup_cancel');
await markSupportSubmissionCheckout(order2,'https://example.test/pay2','pi_followup_cancel');
const cancelled=await cancelPaymentFollowupByUser(order2,userId);
assert(cancelled?.state==='STOPPED','user cancel should stop followup');
assert(cancelled?.stoppedReason==='USER_CANCELLED','user cancel reason failed');
assert(cancelled?.canFollowUp===true,'owner manual follow-up must remain available after user cancel');
assert(cancelled?.stage==='CANCELLED_BY_USER','user cancel audit stage should remain visible');

const [
  supportFeature,
  followupModule,
  paypingData,
  detailPage,
  promotion,
]=await Promise.all([
  readFile('src/features/support.js','utf8'),
  readFile('src/support/payment-followup.js','utf8'),
  readFile('handlers/payping-data.js','utf8'),
  readFile('handlers/payping-transaction-detail-pwa.js','utf8'),
  readFile('src/support/promotion.js','utf8'),
]);

must(supportFeature,"payfollow:review:",'Telegram review callback');
must(supportFeature,"payfollow:cancel:",'Telegram cancel callback');
must(supportFeature,'stopPaymentFollowupForAmountSelection','amount selection stops old follow-up');
must(followupModule,'FIRST_FOLLOWUP_MS = 15 * 60 * 1000','first reminder timing');
must(followupModule,'SECOND_FOLLOWUP_MS = 8 * 60 * 60 * 1000','second reminder timing');
must(followupModule,'MAX_FOLLOWUPS = 1','admin manual follow-up cap');
must(followupModule,'Hi, ${recipient}!😊','username or name greeting');
must(followupModule,"'Hi, Supporter! 😊'",'supporter fallback greeting');
must(followupModule,'tapi belum confirmkan?','updated follow-up copy');
must(followupModule,'masih nak sama2 bantu bot kita semua kekal hidup 🥹🇲🇾','community support copy');
must(followupModule,'Awak boleh continue pembayaran. Terima kasih orang baik! ❤️✨','follow-up closing copy');
must(followupModule,"refreshSupportAmounts()",'configured PayPing support buttons');
must(followupModule,"callback_data:'support:select:'",'dynamic support plan buttons');
must(followupModule,'followupRecipient','Telegram username or name lookup');
must(followupModule,'Dah Bayar / Semak','review button');
must(followupModule,'Tak Jadi','cancel button');
must(followupModule,"keepPassiveAfterManual",'manual follow-up stays passive after cancel');
must(followupModule,"manualUnsuccessfulFollowup",'manual follow-up for unsuccessful order');
must(followupModule,'terminalUnsuccessful','pending reconciliation must not send unsuccessful push');
must(followupModule,"orderStatus.toUpperCase() !== 'PAID'",'only terminal non-paid reconciliation may push unsuccessful');
must(followupModule,'AFFILIATE_FOLLOWUP_COOLDOWN_MS = 8 * 60 * 60 * 1000','affiliate 8 hour cooldown');
must(followupModule,'AFFILIATE_MAX_FOLLOWUPS = 1','legacy affiliate follow-up cap');
must(followupModule,'support_affiliate_followups','affiliate follow-up tracking');
must(followupModule,"TELEGRAM_BOT_BLOCKED",'blocked bot error classification');
must(followupModule,"last_delivery_status",'Telegram delivery persistence');
must(followupModule,"Follow-up gagal — user telah block bot.",'friendly blocked bot message');
must(paypingData,"action==='payment_followup_send'",'followup action');
must(paypingData,"if(!auth.owner)return json(res,403",'admin-only followup route');
must(paypingData,"actorRole:'owner'",'admin actor');
must(paypingData,"action==='payment_followup_check'",'owner reconcile action');
must(paypingData,"action==='payment_followup_stop'",'owner stop action');
must(detailPage,'Manual Payment Follow-up','manual owner UI card');
must(detailPage,'Follow Up (1x)','one-time owner send button');
must(detailPage,'Check Status','owner check button');
must(detailPage,'Stop Follow-up','owner stop button');
must(detailPage,"Bot dah follow up user ✅",'follow-up success toast');
must(detailPage,"Telegram Bot",'Telegram bot status row');
must(detailPage,"Bot Blocked",'blocked bot UI status');
must(detailPage,"friendlyFollowupError",'friendly Telegram error mapping');
must(detailPage,"class=\"toast\"",'top toast UI');
must(detailPage,"const paid=String(d.transaction?.status||'').toUpperCase()==='PAID'",'unsuccessful follow-up remains enabled');
must(detailPage,"if(!d?.owner||!f)",'affiliate never sees manual follow-up');
must(detailPage,"$('stopFollowup').hidden=true",'no automatic reminder to stop');
must(followupModule,"reason:'manual_only'",'inert follow-up scheduler');
must(followupModule,"support_auto_followup_rollout_v3",'future-checkout-only activation watermark');
must(followupModule,"support_auto_followup_claims_v3",'duplicate-safe delivery claims');
must(followupModule,"checked.lookupFailed",'skip message when payment reconciliation is uncertain');
must(followupModule,"support_manual_followup_claims_v4",'durable one-time manual claim');
must(followupModule,"if (!manual || String(actorRole || '').toLowerCase() !== 'owner')",'manual owner-only guard');
must(followupModule,"claimManualFollowup(orderNumber)",'one-time claim before Telegram send');
must(promotion,'startPaymentFollowupScheduler','compatibility startup hook');

console.log('PAYMENT_FOLLOWUP_SELFTEST_OK',JSON.stringify({
  stage:info.stage,
  stopped:stopped.state,
  cancelled:cancelled.state,
  cancelledManualFollowup:cancelled.canFollowUp,
  reminderCap:1,
  affiliateCooldownHours:affiliateInfo.cooldownHours,
}));
