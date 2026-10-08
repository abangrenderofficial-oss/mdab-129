import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isPayPingSharedConfigEnabled,currentSupportAmounts,deriveActiveMediaXAmounts,parseMediaXChannelRule} from '../src/support/payping-shared-config.js';
import {malaysiaSupportSchedule} from '../src/support/daily-force-schedule.js';
import {supportExpiryFromSnapshot} from '../src/support/payping-order-plan.js';
const original=process.env.PAYPING_SHARED_CONFIG_ENABLED;
try{
 delete process.env.PAYPING_SHARED_CONFIG_ENABLED;
 assert.equal(isPayPingSharedConfigEnabled(),false);
 assert.deepEqual(currentSupportAmounts(),[10,20,30,50,100]);
 const friday=new Date('2026-10-09T04:00:00.000Z');
 assert.equal(malaysiaSupportSchedule(friday).weekday,'Fri');
 assert.equal(malaysiaSupportSchedule(friday).dailyForceWindowActive,false);
 process.env.PAYPING_SHARED_CONFIG_ENABLED='true';
 assert.equal(isPayPingSharedConfigEnabled(),true);
 assert.equal(malaysiaSupportSchedule(friday).dailyForceWindowActive,true);
 assert.equal(malaysiaSupportSchedule(friday).dailyForceWindowLabel,'EVERY_DAY');
 assert.equal(supportExpiryFromSnapshot('2026-01-01T00:00:00Z',30).toISOString(),'2026-01-31T00:00:00.000Z');
 assert.equal(supportExpiryFromSnapshot('2026-01-01T00:00:00Z',0).toISOString(),'9999-12-31T23:59:59.000Z');
 assert.equal(supportExpiryFromSnapshot('2026-01-01T00:00:00Z',null),null);
  assert.deepEqual(deriveActiveMediaXAmounts([
   {amount_cents:1000,status:'inactive'},
   {amount_cents:2000,status:'active'},
   {amount_cents:5000,status:'active'},
   {amount_cents:3000,status:'active'},
   {amount_cents:2000,status:'active'},
 ]),[20,30,50]);
 assert.deepEqual(parseMediaXChannelRule({mode:'free_channel',channel_id:'@channelcontoh',channel_after:5}),{mode:'free_channel',channel:'@channelcontoh',threshold:5});
 assert.deepEqual(parseMediaXChannelRule({mode:'free_channel',channel_id:'@channelcontoh',channel_after:0}),{mode:'free_channel',channel:'@channelcontoh',threshold:0});
 assert.equal(parseMediaXChannelRule({mode:'free',channel_id:'@channelcontoh',channel_after:5}),null);
 assert.equal(parseMediaXChannelRule({mode:'free_channel',channel_id:'invalid-link',channel_after:5}),null);
 const channel=await readFile('src/features/channel-gate.js','utf8');
 assert(channel.includes('getMediaXChannelRule'), 'Shared channel config must use the original channel gate');
 assert(channel.includes('getChatMember'), 'Original Telegram membership check must remain intact');
 const support=await readFile('src/features/support.js','utf8');
 assert(support.includes('isSupportAmountCurrentlyActive(amount)'), 'Old callback buttons must be rechecked before checkout');
 assert(support.includes('amountButtonRows(true)'), 'Telegram support button rows must use dynamic amounts');
 const handler=await readFile('handlers/telegram.js','utf8');
 assert(handler.includes('routeUnifiedForceCommand'), 'Old admin commands must use shared Force Support route');
 console.log('PAYPING_SHARED_CONFIG_SELFTEST_OK — all-days Force, legacy fallback, filtered amounts and callback validation');
}finally{
 if(original===undefined)delete process.env.PAYPING_SHARED_CONFIG_ENABLED;
 else process.env.PAYPING_SHARED_CONFIG_ENABLED=original;
}
