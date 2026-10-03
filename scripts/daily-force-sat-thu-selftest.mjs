import { readFile } from 'node:fs/promises';
import { malaysiaSupportSchedule, isDailyForceWindowActive } from '../src/support/daily-force-schedule.js';

function assert(v,m){if(!v)throw new Error(m)}

// Fixed UTC instants that map cleanly to Malaysia local dates.
const thu = new Date('2026-10-01T12:00:00.000Z'); // Thu 20:00 MYT
const fri = new Date('2026-10-02T12:00:00.000Z'); // Fri 20:00 MYT
const sat = new Date('2026-10-03T12:00:00.000Z'); // Sat 20:00 MYT
const sun = new Date('2026-10-04T12:00:00.000Z');

assert(malaysiaSupportSchedule(thu).weekday==='Thu','Thursday detection failed');
assert(isDailyForceWindowActive(thu)===true,'Daily Force must be active Thursday');
assert(malaysiaSupportSchedule(fri).weekday==='Fri','Friday detection failed');
assert(isDailyForceWindowActive(fri)===false,'Daily Force must pause Friday');
assert(malaysiaSupportSchedule(fri).dailyForceWindowLabel==='PAUSED_FRIDAY','Friday pause label missing');
assert(malaysiaSupportSchedule(sat).weekday==='Sat','Saturday detection failed');
assert(isDailyForceWindowActive(sat)===true,'Daily Force must resume Saturday automatically');
assert(isDailyForceWindowActive(sun)===true,'Daily Force must remain active Sunday');

const [daily,friday,monitor,publisher,audit,paymentDetail,menu]=await Promise.all([
  readFile('src/support/daily-force.js','utf8'),
  readFile('src/support/friday-access.js','utf8'),
  readFile('src/support/monitor.js','utf8'),
  readFile('src/support/monitor-publisher.js','utf8'),
  readFile('src/bot/audit.js','utf8'),
  readFile('src/features/payment-detail.js','utf8'),
  readFile('src/bot/commands.js','utf8'),
]);
const must=(s,m,l)=>{if(!s.includes(m))throw new Error(`${l} missing: ${m}`)};

must(daily,"if (!malaysiaSupportSchedule().dailyForceWindowActive) return false;",'claim/mark Friday guard');
must(daily,'pausedForFriday: mode.enabled && schedule.isFriday','runtime pause state');
must(daily,'Jumaat Daily Force auto-pause','command confirmation');
must(daily,'Ia kekal ON sampai kau guna /stopforcesupportdaily.','persistent mode copy');
must(friday,"if (parts.weekday !== 'Fri')",'Friday system day guard');
must(friday,'Mode ini akan berjalan setiap Jumaat selagi belum dihentikan','Friday persistent mode');
must(monitor,"dailyState = 'PAUSED_FRIDAY'",'monitor Friday state');
must(publisher,'Daily Force: ON · PAUSED FRIDAY','auto monitor Friday heading');
must(audit,'Daily Force: PAUSED FRIDAY','USER RECORD Friday status');
must(paymentDetail,'PAUSED FRIDAY','Payment Detail Friday status');
must(menu,'Persistent Sabtu–Khamis','admin menu schedule');

console.log('DAILY_FORCE_SAT_THU_SELFTEST_OK',JSON.stringify({
  thursday:malaysiaSupportSchedule(thu),
  friday:malaysiaSupportSchedule(fri),
  saturday:malaysiaSupportSchedule(sat),
  persistentUntilStop:true,
  fridayOwnedByFridaySupport:true,
}));
