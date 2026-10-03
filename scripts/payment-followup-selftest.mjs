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
  classifyPaymentStage,
  getPaymentFollowupInfo,
  stopPaymentFollowup,
  cancelPaymentFollowupByUser,
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

const info=await getPaymentFollowupInfo(order);
assert(info?.state==='ACTIVE','new followup should be active');
assert(info?.stage==='CHECKOUT_PENDING','new checkout should classify checkout pending');
assert(info?.followupCount===0,'new followup count should be zero');
assert(info?.paymentUrlAvailable===true,'payment URL should be available');
assert(Boolean(info?.nextFollowupAt),'next followup should exist');

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
must(followupModule,'FIRST_FOLLOWUP_MS = 15 * 60 * 1000','first reminder timing');
must(followupModule,'SECOND_FOLLOWUP_MS = 3 * 60 * 60 * 1000','second reminder timing');
must(followupModule,'MAX_FOLLOWUPS = 2','reminder cap');
must(followupModule,'Hi, @','username greeting');
must(followupModule,"'Hi, 😊'",'fallback greeting');
must(followupModule,'Awak ada checkout','new follow-up copy');
must(followupModule,'Terima kasih buat pembayaran ❤️','username thank-you copy');
must(followupModule,'Terima kasih orang baik ❤️','fallback thank-you copy');
must(followupModule,'💳 Bayar ${followupAmountLabel(row)}','amount payment button');
must(followupModule,'Dah Bayar / Semak','review button');
must(followupModule,'Tak Jadi','cancel button');
must(followupModule,"keepPassiveAfterManual",'manual follow-up stays passive after cancel');
must(followupModule,"manualCancelledFollowup",'manual follow-up for cancelled order');
must(followupModule,"TELEGRAM_BOT_BLOCKED",'blocked bot error classification');
must(followupModule,"last_delivery_status",'Telegram delivery persistence');
must(followupModule,"Follow-up gagal — user telah block bot.",'friendly blocked bot message');
must(paypingData,"action==='payment_followup_send'",'owner followup action');
must(paypingData,"action==='payment_followup_check'",'owner reconcile action');
must(paypingData,"action==='payment_followup_stop'",'owner stop action');
must(detailPage,'Pending Payment Follow-up','owner UI card');
must(detailPage,'Follow Up Now','owner send button');
must(detailPage,'Check Status','owner check button');
must(detailPage,'Stop Follow-up','owner stop button');
must(detailPage,"Bot dah follow up user ✅",'follow-up success toast');
must(detailPage,"Telegram Bot",'Telegram bot status row');
must(detailPage,"Bot Blocked",'blocked bot UI status');
must(detailPage,"friendlyFollowupError",'friendly Telegram error mapping');
must(detailPage,"class=\"toast\"",'top toast UI');
must(detailPage,"['PAID','FAILED','EXPIRED','INTENT_FAILED','AMOUNT_MISMATCH']", 'cancelled follow-up remains enabled');
must(promotion,'startPaymentFollowupScheduler','scheduler startup');

console.log('PAYMENT_FOLLOWUP_SELFTEST_OK',JSON.stringify({
  stage:info.stage,
  stopped:stopped.state,
  cancelled:cancelled.state,
  cancelledManualFollowup:cancelled.canFollowUp,
  reminderCap:2,
}));
