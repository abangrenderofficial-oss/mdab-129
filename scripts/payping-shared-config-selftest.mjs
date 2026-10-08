import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isPayPingSharedConfigEnabled,currentSupportAmounts,deriveActiveMediaXAmounts} from '../src/support/payping-shared-config.js';
import {malaysiaSupportSchedule} from '../src/support/daily-force-schedule.js';
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
 assert.deepEqual(deriveActiveMediaXAmounts([
   {amount_cents:1000,status:'inactive'},
   {amount_cents:2000,status:'active'},
   {amount_cents:5000,status:'active'},
   {amount_cents:3000,status:'active'},
   {amount_cents:2000,status:'active'},
 ]),[20,30,50]);
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
