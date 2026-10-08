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
 assert.deepEqual(parseMediaXChannelRule({mode:'free_channel',channel_id:'@channelcontoh',channel_after:5,campaign_seq:1,campaign_channel_id:'@channelcontoh',activated_at:'2026-10-08T00:00:00Z'}),{mode:'free_channel',channel:'@channelcontoh',threshold:1,campaignSequence:1});
 assert.deepEqual(parseMediaXChannelRule({mode:'free_channel',channel_id:'@channelcontoh',channel_after:0,campaign_seq:1,campaign_channel_id:'@channelcontoh',activated_at:'2026-10-08T00:00:00Z'}),{mode:'free_channel',channel:'@channelcontoh',threshold:1,campaignSequence:1});
 assert.equal(parseMediaXChannelRule({mode:'free',channel_id:'@channelcontoh',channel_after:5}),null);
 assert.equal(parseMediaXChannelRule({mode:'free_channel',channel_id:'invalid-link',channel_after:5}),null);
 assert.equal(parseMediaXChannelRule({mode:'free_channel',channel_id:'@channelcontoh',channel_after:1}),null,'A saved policy must never lock users before its explicit activation campaign exists');
 assert.equal(parseMediaXChannelRule({mode:'free_channel',channel_id:'@channelcontoh',campaign_seq:2,campaign_channel_id:'@differentchannel',activated_at:'2026-10-08T00:00:00Z'}),null);
 const channel=await readFile('src/features/channel-gate.js','utf8');
 assert(channel.includes('getMediaXChannelRule'), 'Shared channel config must use the original channel gate');
 assert(channel.includes('getChatMember'), 'Original Telegram membership check must remain intact');
 assert(channel.includes('if(isPayPingSharedConfigEnabled())return {gateRequired:false'), 'Legacy fifth-HQ gate must stay OFF during synced Force Support and Free mode');
 assert(channel.includes('if(await isDailyForceSupportEnabled())return'), 'Force Support must override a stale Free + Channel policy');
 assert(channel.includes('hasMediaXChannelCampaignUse(userId,remote.campaignSequence)'), 'Channel gate must use new campaign success records, never accumulated HQ history');
 const completion=await readFile('src/support/premium-hq-completion.js','utf8');
 assert(completion.includes('recordMediaXChannelCampaignUse(id,label)'), 'A successfully delivered HQ item must count against the new campaign');
 const android=await readFile('src/features/status-hq-android.js','utf8');
 assert(android.includes('androidHqCompleted = true; // Count only after Telegram confirms successful delivery.'),'Android must count only after Telegram upload success');
 assert(android.indexOf('await sendVideoFileUpload(')<android.indexOf('androidHqCompleted = true;'),'Android HQ cannot count before upload success');
 assert(android.includes('completionCallbackUrl: baseUrl'),'Heavy Android must have a signed completion callback');
 const gated=await readFile('src/bot/gated-media-flow.js','utf8');
 assert(gated.includes('androidResult?.androidHqCompleted')&&gated.includes('await recordPremiumHqSuccess({'),'Premium & Android HQ must share one completion counter');
 assert(gated.includes('await releaseClaims(userId, claims.fridayClaimed, claims.dailyClaimed);'),'Failed Android HQ must release access claims');
 const workflow=await readFile('.github/workflows/heavy-status-hq.yml','utf8');
 const androidJob=workflow.slice(workflow.indexOf('  status_hq_android:'),workflow.indexOf('  live_wallpaper:'));
 assert(androidJob.includes('Record Android HQ delivery')&&androidJob.includes('completion_callback_url'),'Heavy Android must report only successful deliveries');
 const support=await readFile('src/features/support.js','utf8');
 assert(support.includes('isSupportAmountCurrentlyActive(amount)'), 'Old callback buttons must be rechecked before checkout');
 assert(support.includes('amountButtonRows(true)'), 'Telegram support button rows must use dynamic amounts');
 const handler=await readFile('handlers/telegram.js','utf8');
 assert(handler.includes('routeUnifiedForceCommand'), 'Old admin commands must use shared Force Support route');
 console.log('PAYPING_SHARED_CONFIG_SELFTEST_OK — one successful HQ/Android HQ before channel lock, legacy fallback, safe callback and payment checks');
}finally{
 if(original===undefined)delete process.env.PAYPING_SHARED_CONFIG_ENABLED;
 else process.env.PAYPING_SHARED_CONFIG_ENABLED=original;
}
