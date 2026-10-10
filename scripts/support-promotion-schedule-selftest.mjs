import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { supportCampaignText, supportMenuKeyboard } from '../src/features/support.js';
import { supportPromotionScheduleState } from '../src/support/promotion.js';

const previous = process.env.PAYPING_SHARED_CONFIG_ENABLED;
try {
  process.env.PAYPING_SHARED_CONFIG_ENABLED = 'true';

  // All instants below use UTC; scheduler must use Malaysia local day and time.
  const fridayBefore = supportPromotionScheduleState(new Date('2026-10-09T01:59:00Z')); // 09:59 MY
  const friday = supportPromotionScheduleState(new Date('2026-10-09T02:00:00Z')); // 10:00 MY
  const fridayAfternoon = supportPromotionScheduleState(new Date('2026-10-09T07:00:00Z')); // 15:00 MY
  const saturdayMorning = supportPromotionScheduleState(new Date('2026-10-10T02:00:00Z')); // 10:00 MY
  const saturday = supportPromotionScheduleState(new Date('2026-10-10T07:09:00Z')); // 15:09 MY
  const sunday = supportPromotionScheduleState(new Date('2026-10-11T07:00:00Z')); // 15:00 MY

  assert.equal(friday.weekday, 'Fri');
  assert.equal(friday.scheduledHour, 10);
  assert.equal(friday.due, true);
  assert.equal(friday.privateDue, true);
  assert.equal(fridayBefore.due, false);
  assert.equal(fridayAfternoon.due, false, 'Friday campaign must not re-run in the daily slot');

  assert.equal(saturday.weekday, 'Sat');
  assert.equal(saturday.scheduledHour, 15);
  assert.equal(saturday.due, true);
  assert.equal(saturday.privateDue, true);
  assert.equal(saturdayMorning.due, false, 'Saturday must not use Friday slot');
  assert.equal(sunday.weekday, 'Sun');
  assert.equal(sunday.due, true);

  const privateFriday = supportCampaignText({ isFriday: true, audience: 'private' });
  const privateSaturday = supportCampaignText({ isFriday: false, audience: 'private' });
  const channelFriday = supportCampaignText({ isFriday: true, audience: 'channel' });
  const channelSaturday = supportCampaignText({ isFriday: false, audience: 'channel' });

  assert.match(privateFriday, /Salam JUMAAT/);
  assert.match(channelFriday, /Salam JUMAAT/);
  assert.doesNotMatch(privateSaturday, /JUMAAT|Mubarak/i, 'Saturday must not say Salam Jumaat');
  assert.doesNotMatch(channelSaturday, /JUMAAT|Mubarak/i);
  for (const message of [privateFriday, privateSaturday]) {
    assert.match(message, /Hi, awak!/);
    assert.doesNotMatch(message, /\bkorang\b|Hi, Semua!/i, 'Private copy must address awak');
  }
  for (const message of [channelFriday, channelSaturday]) {
    assert.match(message, /Hi, korang!/);
    assert.doesNotMatch(message, /\bawak\b|Hi, Semua!/i, 'Channel copy must address korang');
  }

  const keyboard = supportMenuKeyboard().inline_keyboard;
  assert.deepEqual(keyboard.at(-1).map((button) => button.text), ['↩️ Back']);
  assert(keyboard.some((row) => row.some((button) => button.text === 'RM10')));

  const routing = await readFile('src/support/promotion.js', 'utf8');
  assert(routing.includes('sendPrivatePromotion(userId, weekday)'));
  assert(routing.includes("isFriday: weekday === 'Fri', audience: 'private'"));
  assert(routing.includes("supportCampaignText({ isFriday: true, audience: 'channel' })"));
  assert(routing.includes('deliverChannelDaily(parts.dateKey, parts.weekday)'));
  assert(routing.includes("const periodKey = `all-users:${dateKey}`"), 'Once-per-day claim must remain intact');

  console.log('SUPPORT_PROMOTION_SCHEDULE_SELFTEST_OK — Friday 10:00, Sat–Thu 15:00, private/channel copy and dedupe');
} finally {
  if (previous === undefined) delete process.env.PAYPING_SHARED_CONFIG_ENABLED;
  else process.env.PAYPING_SHARED_CONFIG_ENABLED = previous;
}
