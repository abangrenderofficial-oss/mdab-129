import { enqueueUserHeavyJob } from './bot/user-job-queue.js';
import { isJobFenceActive } from './recovery.js';
import { sendMessage } from './telegram.js';
import { recordUsage } from './bot/stats.js';
import { processStandardDownload } from './features/downloader.js';
import { processStatusFromLink } from './features/status-hq.js';
import { sendTikTokSlideshowChoice } from './features/tiktok-slideshow.js';
import { recordPremiumHqSuccess } from './support/premium-hq-completion.js';
import {
  claimFridayUsageAttempt,
  enforceFridaySupportForMessage,
  markFridayUsageSuccess,
  releaseFridayUsageAttempt,
} from './support/friday-access.js';
import {
  claimDailyForceUsageAttempt,
  enforceDailyForceSupportForMessage,
  releaseDailyForceUsageAttempt,
} from './support/daily-force.js';

function hasDownloadableMedia(result) {
  if (!result || result.cancelled) return false;
  if (result.slideshow || result.sentVideo) return true;
  if (Array.isArray(result?.media?.images) && result.media.images.length) return true;
  return Array.isArray(result?.media?.audios) && result.media.audios.length > 0;
}

async function markFridaySuccess(userId, label) {
  await markFridayUsageSuccess(userId).catch((error) => {
    console.warn(`[friday-support] ${label} mark failed:`, error?.message);
  });
}

async function runLinkJob({ message, context, url, platform, statusMode, fridayClaimed = false, dailyClaimed = false }) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return;

  try {
    if (!fridayClaimed && await enforceFridaySupportForMessage(message)) return;
    if (!dailyClaimed && await enforceDailyForceSupportForMessage(message)) return;

    if (statusMode) {
      const completed = await processStatusFromLink(chatId, url, platform, context.fence);
      if (completed) {
        await recordPremiumHqSuccess({
          userId,
          chatId,
          label: 'premium hq status link',
          completionKey: `link:${chatId}:${String(message?.message_id || '')}:status_hq`,
        });
      } else {
        if (fridayClaimed) await releaseFridayUsageAttempt(userId).catch(() => {});
        if (dailyClaimed) await releaseDailyForceUsageAttempt(userId).catch(() => {});
      }
      return;
    }

    const result = await processStandardDownload({ chatId, url, platform, context, message });
    if (result?.slideshow) {
      await sendTikTokSlideshowChoice(chatId, url);
      if (fridayClaimed) await releaseFridayUsageAttempt(userId).catch(() => {});
      if (dailyClaimed) await releaseDailyForceUsageAttempt(userId).catch(() => {});
    } else if (hasDownloadableMedia(result)) {
      await recordUsage(userId, 'download');
      await markFridaySuccess(userId, 'download');
    } else {
      if (fridayClaimed) await releaseFridayUsageAttempt(userId).catch(() => {});
      if (dailyClaimed) await releaseDailyForceUsageAttempt(userId).catch(() => {});
    }
  } catch (error) {
    if (fridayClaimed) await releaseFridayUsageAttempt(userId).catch(() => {});
    if (dailyClaimed) await releaseDailyForceUsageAttempt(userId).catch(() => {});
    throw error;
  }
}

export async function scheduleLinkJob({ message, context = {}, url, platform, statusMode = false }) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return false;

  if (await enforceFridaySupportForMessage(message)) return true;
  if (await enforceDailyForceSupportForMessage(message)) return true;

  const fridayClaimed = await claimFridayUsageAttempt(userId);
  if (!fridayClaimed && await enforceFridaySupportForMessage(message)) return true;

  let dailyClaimed = false;
  if (statusMode) {
    dailyClaimed = await claimDailyForceUsageAttempt(userId);
    if (!dailyClaimed && await enforceDailyForceSupportForMessage(message)) {
      if (fridayClaimed) await releaseFridayUsageAttempt(userId).catch(() => {});
      return true;
    }
  }

  const queued = enqueueUserHeavyJob(
    userId,
    () => runLinkJob({ message, context, url, platform, statusMode, fridayClaimed, dailyClaimed }),
    { shouldRun: () => isJobFenceActive(context.fence) },
  );

  if (!queued.accepted) {
    if (fridayClaimed) await releaseFridayUsageAttempt(userId).catch(() => {});
    if (dailyClaimed) await releaseDailyForceUsageAttempt(userId).catch(() => {});
    await sendMessage(
      chatId,
      `⏳ Queue kau dah penuh. Maksimum ${queued.limit || 5} proses berat untuk seorang user. Tunggu yang sekarang siap dulu ya.`,
    ).catch(() => {});
    return true;
  }

  if (queued.queued) {
    await sendMessage(
      chatId,
      `⏳ Link ni dah masuk queue #${queued.position}. Aku proses satu-satu supaya bot kekal stabil.`,
    ).catch(() => {});
  }

  queued.done?.catch((error) => {
    console.error('[link-queue] queued job failed:', error?.code, error?.message);
  });
  return true;
}
