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
must(followupModule,'Continue Payment','continue payment button');
must(followupModule,'Dah Bayar / Semak','review button');
must(followupModule,'Tak Jadi','cancel button');
must(paypingData,"action==='payment_followup_send'",'owner followup action');
must(paypingData,"action==='payment_followup_check'",'owner reconcile action');
must(paypingData,"action==='payment_followup_stop'",'owner stop action');
must(detailPage,'Pending Payment Follow-up','owner UI card');
must(detailPage,'Follow Up Now','owner send button');
must(detailPage,'Check Status','owner check button');
must(detailPage,'Stop Follow-up','owner stop button');
must(promotion,'startPaymentFollowupScheduler','scheduler startup');

console.log('PAYMENT_FOLLOWUP_SELFTEST_OK',JSON.stringify({
  stage:info.stage,
  stopped:stopped.state,
  cancelled:cancelled.state,
  reminderCap:2,
}));
