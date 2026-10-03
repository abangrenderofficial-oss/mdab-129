import { recordSupportMonitorSeen } from './monitor.js';
import { refreshSupportMonitorMessage } from './monitor-publisher.js';

export async function trackSupportMonitorActor(actor, actorChatType) {
  if (actorChatType !== 'private' || !actor?.id) return { tracked: false };

  const monitorSeen = await recordSupportMonitorSeen(actor).catch((error) => {
    console.warn('[support-monitor] seen record failed:', error?.message);
    return null;
  });

  if (monitorSeen?.changed) {
    await refreshSupportMonitorMessage().catch((error) => {
      console.warn('[support-monitor] auto refresh after user change failed:', error?.message);
    });
  }

  return {
    tracked: Boolean(monitorSeen?.recorded),
    changed: Boolean(monitorSeen?.changed),
    isNew: Boolean(monitorSeen?.isNew),
  };
}

export async function refreshSupportMonitorForMode(label = '') {
  return refreshSupportMonitorMessage({ force: true }).catch((error) => {
    console.warn(
      `[support-monitor] refresh after daily-force ${label || 'change'} failed:`,
      error?.message,
    );
    return { updated: false, reason: 'refresh_failed' };
  });
}
