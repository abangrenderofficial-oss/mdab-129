import { markPremiumHqCompleted, recordUsage } from '../bot/stats.js';
import { maybePromptChannelAfterSuccess } from '../features/channel-gate.js';
import { markFridayUsageSuccess } from './friday-access.js';
import { markDailyForceUsageSuccess } from './daily-force.js';

export async function recordPremiumHqSuccess({
  userId,
  chatId,
  label = 'premium hq',
  completionKey = '',
} = {}) {
  const id = Number(userId || 0);
  const chat = Number(chatId || 0);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { completed: false, reason: 'invalid_user' };
  }

  await recordUsage(id, 'status_hq');
  const channelCounted = await markPremiumHqCompleted(id, completionKey);

  const fridayMarked = await markFridayUsageSuccess(id).catch((error) => {
    console.warn(`[friday-support] ${label} mark failed:`, error?.message);
    return false;
  });

  const dailyMarked = await markDailyForceUsageSuccess(id).catch((error) => {
    console.warn(`[daily-force] ${label} mark failed:`, error?.message);
    return false;
  });

  const channelPrompted = chat > 0
    ? await maybePromptChannelAfterSuccess(chat, id).catch((error) => {
        console.warn('[channel-gate] Premium HQ prompt failed:', error?.message);
        return false;
      })
    : false;

  return {
    completed: true,
    fridayMarked: Boolean(fridayMarked),
    dailyMarked: Boolean(dailyMarked),
    channelPrompted: Boolean(channelPrompted),
    channelCounted: Boolean(channelCounted),
  };
}
