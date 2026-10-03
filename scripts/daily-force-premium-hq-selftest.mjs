import { readFile } from 'node:fs/promises';
import { supportChannelScheduleState } from '../src/support/promotion.js';

function assert(v,m){if(!v)throw new Error(m)}
const must=(s,m,l)=>{if(!s.includes(m))throw new Error(`${l} missing: ${m}`)};

// Malaysia 13:19 and 13:20 on the same day.
const before = supportChannelScheduleState(new Date('2026-10-03T05:19:00.000Z'));
const due = supportChannelScheduleState(new Date('2026-10-03T05:20:00.000Z'));
assert(before.timezone==='Asia/Kuala_Lumpur','channel timezone must be Malaysia');
assert(before.scheduledHour===13&&before.scheduledMinute===20,'channel schedule must be 13:20');
assert(before.due===false,'channel must not be due at 13:19');
assert(due.due===true,'channel must become due at 13:20');

const [support,daily,gated,link,status,heavy,promo,completion,monitor,audit] = await Promise.all([
  readFile('src/features/support.js','utf8'),
  readFile('src/support/daily-force.js','utf8'),
  readFile('src/bot/gated-media-flow.js','utf8'),
  readFile('src/link-queue.js','utf8'),
  readFile('src/features/status-hq.js','utf8'),
  readFile('handlers/premium-hq-success.js','utf8'),
  readFile('src/support/promotion.js','utf8'),
  readFile('src/support/premium-hq-completion.js','utf8'),
  readFile('src/support/monitor.js','utf8'),
  readFile('src/bot/audit.js','utf8'),
]);

const exactCopy = [
  'Hi, awak!',
  'Best tak dapat download video and post di status whatsapp tak pecah?',
  'Whatsapp awak sekarang dah PREMIUM! ☕️',
  'Utk pengetahuan awak bot ni hak milik kita semua 🇲🇾.',
  'Tapi sayang bot ni boleh mati bila2 masa 🥹, klau kita tak berjaya bayar kos sewa server.',
  'Jadi kalau awak suka bot ni, jom kita support nak? Setahun sekali pun boleh, terima kasih orang baik 🙇🏻✨',
];
for(const line of exactCopy) must(support,line,'Daily Force exact private support copy');

const channelCopy = [
  'Hi, korang!',
  'Whatsapp korang sekarang dah PREMIUM! ☕️',
  'Utk pengetahuan korang bot ni hak milik kita semua 🇲🇾.',
  'Jadi kalau korang suka bot ni, jom kita support nak? Setahun sekali pun boleh, terima kasih orang baik 🙇🏻✨',
];
for(const line of channelCopy) must(support,line,'Daily Force exact channel support copy');

must(support,'export function supportAmountKeyboard()','amount-only support keyboard');
for(const amount of ['10','20','30','50','100']) {
  must(support,`SUPPORT_SELECT_PREFIX}${amount}`,'support amount '+amount);
}
must(daily,"const DAILY_FORCE_COPY = 'Please support bot utk teruskan guna ❤️';",'locked private reply');
must(daily,'dailyForcePremiumSupportText()','first-success long promo');
must(daily,'supportAmountKeyboard()','Daily Force amount buttons');
must(daily,'AND used_once = 0','idempotent first success');
must(daily,'policy_version INTEGER NOT NULL DEFAULT 3','one-free-success policy version');
must(daily,'restored one-free-success policy without resetting current cycle','non-destructive policy migration');
must(daily,"gateReason: state.usedOnce",'support-required gate reason');
must(daily,"'processing_first_use'",'processing gate reason');

must(gated,'const claims = await claimBoth(userId, callbackQuery, true);','Daily claim for every media callback');
must(gated,'premiumResult?.premiumHqCompleted','local Premium HQ completion');
must(gated,'premiumResult?.premiumVideoDispatched','heavy Premium HQ dispatch hold');
must(gated,"label: 'premium hq callback'",'shared Premium completion');
must(gated,'completionKey:','Premium completion dedupe key');
must(gated,'markDailyForceUsageSuccess(userId)','generic successful media consumes the free use');

must(link,'const dailyClaimed = await claimDailyForceUsageAttempt(userId);','Daily claim for every link job');
must(link,"label: 'premium hq status link'",'status-link Premium completion');
must(link,'completionKey:','status-link completion dedupe key');
must(link,'markDailyForceUsageSuccess(userId)','normal successful download consumes the free use');

must(status,'premiumImageCompleted = true','photo Premium HQ completion');
must(status,'premiumHqCompleted: true','unified Premium HQ completion flag');
must(heavy,"label: 'premium hq heavy worker'",'heavy worker Premium completion');
must(completion,'markDailyForceUsageSuccess(id)','shared Daily Force completion');
must(completion,'markFridayUsageSuccess(id)','shared Friday completion');

must(promo,'const DEFAULT_CHANNEL_PROMO_HOUR = 13;','channel 13 hour');
must(promo,'const DEFAULT_CHANNEL_PROMO_MINUTE = 20;','channel minute 20');
must(promo,'const CHECK_INTERVAL_MS = 60 * 1000;','minute scheduler');
must(promo,'channel-daily:','daily channel dedupe key');
must(promo,'dailyForcePremiumChannelSupportText()','channel uses korang Premium support copy');

must(monitor,"dailyState = 'PROCESSING_FIRST_USE'",'monitor processing state');
must(audit,'PROCESSING FIRST USE','USER RECORD processing state');

console.log('DAILY_FORCE_ONE_FREE_SUCCESS_SELFTEST_OK',JSON.stringify({
  channelBefore:before,
  channelDue:due,
  privatePromptExact:true,
  amountButtons:[10,20,30,50,100],
  allSuccessfulMediaLocks:true,
  heavyWorkerCovered:true,
  photoCovered:true,
}));
