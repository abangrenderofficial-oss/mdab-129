import { readFile } from 'node:fs/promises';
import { buildSupportMonitorMessage } from '../src/support/monitor-publisher.js';

function assert(v,m){if(!v)throw new Error(m)}

const sample = buildSupportMonitorMessage({
  dailyForceEnabled: true,
  cycleId: 9,
  users: [{}, {}, {}],
  supported: [{
    userId: '101',
    username: 'supporter',
    support: { tierLabel: '🤍 Supporter', expiresAt: '2027-10-03T00:00:00.000Z' },
    dailyForce: { state: 'EXEMPT_SUPPORTER', cycleId: 9, successCount: 0, anomaly: false },
  }],
  unsupported: [
    {
      userId: '202',
      username: 'locked',
      support: { active: false },
      dailyForce: { state: 'LOCKED', cycleId: 9, successCount: 1, anomaly: false },
    },
    {
      userId: '303',
      username: 'badcase',
      support: { active: false },
      dailyForce: { state: 'LOCKED', cycleId: 9, successCount: 2, anomaly: true },
    },
  ],
  locked: [{}, {}],
  anomalies: [{}],
});

assert(sample.includes('📊 SUPPORT MONITOR — AUTO'),'auto monitor heading missing');
assert(sample.includes('✅ ACTIVE SUPPORTERS'),'supported section missing');
assert(sample.includes('@supporter'),'supported user missing');
assert(sample.includes('🔒 @locked'),'locked user missing');
assert(sample.includes('⚠️ @badcase'),'anomaly user missing');
assert(sample.includes('Daily Force: ON · Sabtu–Khamis · Cycle 9'),'cycle status missing');
assert(sample.length < 4000,'auto monitor message exceeds Telegram text limit');

const [publisher,monitor,hooks,router,daily,bayarcash,paymentDetail,server]=await Promise.all([
  readFile('src/support/monitor-publisher.js','utf8'),
  readFile('src/support/monitor.js','utf8'),
  readFile('src/support/monitor-hooks.js','utf8'),
  readFile('handlers/telegram.js','utf8'),
  readFile('src/support/daily-force.js','utf8'),
  readFile('handlers/bayarcash.js','utf8'),
  readFile('src/features/payment-detail.js','utf8'),
  readFile('server.js','utf8'),
]);

const must=(s,m,l)=>{if(!s.includes(m))throw new Error(`${l} missing: ${m}`)};
must(publisher,'support_monitor_message','persistent monitor message table');
must(publisher,"telegram('editMessageText'","edit same Telegram message");
must(publisher,"mode: 'created'","create monitor fallback");
must(publisher,"reason: 'unchanged'","unchanged dedupe");
must(monitor,'return { recorded: true, changed, isNew: !previous }','meaningful user change signal');
must(hooks,'if (monitorSeen?.changed)','user-change auto refresh');
must(hooks,"refreshSupportMonitorMessage({ force: true })",'Daily Force mode refresh');
must(router,'trackSupportMonitorActor(actor, actorChatType)','thin-router monitor tracking');
must(router,"refreshSupportMonitorForMode('ON')",'thin-router Daily Force refresh');
must(daily,'refresh after Daily Force success failed','usage-success refresh');
must(bayarcash,'refresh after paid support failed','payment-success refresh');
must(paymentDetail,'initial auto monitor failed','connect-time refresh');
must(server,"refreshSupportMonitorMessage({ force: true })",'Railway startup refresh');

console.log('AUTO_SUPPORT_MONITOR_SELFTEST_OK',JSON.stringify({
  messageLength: sample.length,
  sameMessageEdit: true,
  triggers: ['startup','new-user','daily-force-mode','daily-force-success','paid-support','connect'],
}));
