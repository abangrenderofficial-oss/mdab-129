import { enqueueUserHeavyJob } from './bot/user-job-queue.js';
import { isJobFenceActive } from './recovery.js';
import { sendMessage } from './telegram.js';
import { markPremiumHqCompleted, recordUsage } from './bot/stats.js';
import { processStandardDownload } from './features/downloader.js';
import { processStatusFromLink } from './features/status-hq.js';
import { sendTikTokSlideshowChoice } from './features/tiktok-slideshow.js';
import { maybePromptChannelAfterSuccess } from './features/channel-gate.js';
import {
  enforceFridaySupportForMessage,
  markFridayUsageSuccess,
} from './support/friday-access.js';

function hasDownloadableMedia(result) {
  if (!result || result.cancelled) return false;
  if (result.slideshow || result.sentVideo) return true;
  if (Array.isArray(result?.media?.images) && result.media.images.length) return true;
  return Array.isArray(result?.media?.audios) && result.media.audios.length > 0;
}

async function recordPremiumHqSuccess(userId, chatId) {
  await recordUsage(userId, 'status_hq');
  await markPremiumHqCompleted(userId);
  await markFridayUsageSuccess(userId).catch((error) => {
    console.warn('[friday-support] status success mark failed:', error?.message);
  });
  await maybePromptChannelAfterSuccess(chatId, userId);
}

async function runLinkJob({ message, context, url, platform, statusMode }) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return;

  // Re-check when the queued job actually starts. This closes the loophole where a
  // user queues several links before their first free FORCE-mode download finishes.
  if (await enforceFridaySupportForMessage(message)) return;

  if (statusMode) {
    const completed = await processStatusFromLink(chatId, url, platform, context.fence);
    if (completed) await recordPremiumHqSuccess(userId, chatId);
    return;
  }

  const result = await processStandardDownload({ chatId, url, platform, context, message });
  if (result?.slideshow) {
    await sendTikTokSlideshowChoice(chatId, url);
  } else if (hasDownloadableMedia(result)) {
    await recordUsage(userId, 'download');
    await markFridayUsageSuccess(userId).catch((error) => {
      console.warn('[friday-support] download success mark failed:', error?.message);
    });
  }
}

export async function scheduleLinkJob({ message, context = {}, url, platform, statusMode = false }) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return false;

  // Fast pre-check so an already locked user does not enter the heavy queue at all.
  if (await enforceFridaySupportForMessage(message)) return true;

  const queued = enqueueUserHeavyJob(
    userId,
    () => runLinkJob({ message, context, url, platform, statusMode }),
    { shouldRun: () => isJobFenceActive(context.fence) },
  );

  if (!queued.accepted) {
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
