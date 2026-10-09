import { markPremiumHqCompleted, recordUsage } from '../bot/stats.js';
import { maybePromptChannelAfterSuccess } from '../features/channel-gate.js';
import { markFridayUsageSuccess } from './friday-access.js';
import { markDailyForceUsageSuccess, completeFirstDailyForceHq } from './daily-force.js';
import {recordMediaXChannelCampaignUse,completeMediaXFirstHq} from './payping-shared-config.js';

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

  const normalizedCompletionKey = String(completionKey || '').trim().slice(0, 240);
  let channelCounted;
  if (normalizedCompletionKey) {
    // Render worker retry: atomically record the HQ key and usage once.
    channelCounted = await markPremiumHqCompleted(id, normalizedCompletionKey, {
      recordCompletionUse: true,
    });
    if (!channelCounted) {
      return {
        completed: true,
        duplicate: true,
        channelCounted: false,
        campaignCounted: false,
        fridayMarked: false,
        dailyMarked: false,
        channelPrompted: false,
      };
    }
  } else {
    // Preserve behavior of older Telegram routes without completion keys.
    await recordUsage(id, 'status_hq');
    channelCounted = await markPremiumHqCompleted(id, completionKey);
  }
  // Explicitly activated Free+Channel campaign only; Force Support stays
  // independent and historical HQ counters are never reset.
  const campaignCounted = await recordMediaXChannelCampaignUse(id,label).catch(error=>{
    console.warn('[payping-shared] channel campaign completion failed:',error?.message);
    return false;
  });

  const fridayMarked = await markFridayUsageSuccess(id).catch((error) => {
    console.warn(`[friday-support] ${label} mark failed:`, error?.message);
    return false;
  });

  const dailyMarked = await markDailyForceUsageSuccess(id).catch((error) => {
    console.warn(`[daily-force] ${label} mark failed:`, error?.message);
    return false;
  });

  await completeMediaXFirstHq(id).catch(error=>{
    console.warn('[payping-shared] first channel HQ completion failed:',error?.message);
  });

  // Complete the original media session's HQ conversion, without granting
  // a second download. Support is requested only on the next new input.
  await completeFirstDailyForceHq(id).catch(error=>{
    console.warn('[daily-force] first-session HQ completion failed:',error?.message);
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
    campaignCounted: Boolean(campaignCounted),
  };
}
