import {isPayPingSharedConfigEnabled} from './payping-shared-config.js';
const MALAYSIA_TIMEZONE = 'Asia/Kuala_Lumpur';

export function malaysiaSupportSchedule(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MALAYSIA_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const weekday = String(parts.weekday || '');
  const isFriday = weekday === 'Fri';

  return {
    timezone: MALAYSIA_TIMEZONE,
    weekday,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    isFriday,
    dailyForceWindowActive: isPayPingSharedConfigEnabled() ? true : !isFriday,
    dailyForceWindowLabel: isPayPingSharedConfigEnabled() ? 'EVERY_DAY' : (isFriday ? 'PAUSED_FRIDAY' : 'SAT_THU'),
  };
}

export function isDailyForceWindowActive(date = new Date()) {
  return malaysiaSupportSchedule(date).dailyForceWindowActive;
}
