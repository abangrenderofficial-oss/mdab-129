import { prepareWhatsAppStatusHQ } from '../status-hq.js';
import { prepareWhatsAppStatusImageHQ } from '../status-image-hq.js';
import { detectPlatform } from '../platform.js';
import { resolveInstagramAudio } from '../instagram-audio.js';
import { getTelegramFileSource, sendChatAction, sendMessage, sendVideoFileUpload, telegram } from '../telegram.js';
import { dispatchHeavyMediaJob, heavyVideoLimitBytes, heavyWorkerConfigured, shouldUseHeavyWorker } from '../heavy-worker-dispatch.js';
import { isJobFenceActive } from '../recovery.js';
import { chooseBestVideo, resolveMedia } from '../bot/media-resolver.js';
import {
  MEDIA_STATUS_HQ,
  callbackSourceUrl,
  claimMediaButtons,
  galleryMediaMeta,
} from '../bot/media-actions.js';
import { localMediaLane } from '../bot/job-lanes.js';
import { removeHeavyProgress, startHeavyStatusProgress, startImageStatusProgress, startStatusProgress } from '../bot/progress.js';
import { sendDocumentFileUpload } from '../bot/telegram-document.js';
import { statusImageCaption, statusVideoCaption } from '../bot/status-caption.js';

function cancelled(fence) {
  return fence && !isJobFenceActive(fence);
}

async function prepareStatusFromSourceUrl(url, platform) {
  if (platform === 'youtube') {
    return prepareWhatsAppStatusHQ({ sourceUrl: url, platform, video: null, audio: null });
  }

  const media = await resolveMedia(platform, url);
  const best = chooseBestVideo(media?.videos || []);
  if (!best) {
    const error = new Error('No suitable source video for Status HQ.');
    error.code = 'STATUS_SOURCE_NOT_FOUND';
    throw error;
  }

  let audio = Array.isArray(media?.audios)
    ? media.audios.find((item) => item?.url) || null
    : null;

  if (platform !== 'instagram') {
    return prepareWhatsAppStatusHQ({ sourceUrl: url, platform, video: best, audio });
  }

  // IMPORTANT: Instagram resolvers can return a direct MP4 that already contains
  // the audible Reel mix even when media.audios[] is empty. Production used to
  // treat an empty audios[] as proof that audio was missing and immediately call
  // the separate metadata recovery endpoint. That endpoint can be rate-limited
  // (HTTP 403), causing Premium+ HQ to fail even though the direct MP4 itself had
  // perfectly usable audio. Always try + verify the direct resolved video first.
  let directPrepared = null;
  try {
    directPrepared = await prepareWhatsAppStatusHQ({
      sourceUrl: '',
      platform: 'instagram-direct',
      video: best,
      audio,
    });
    if (directPrepared?.profile?.hasAudio) {
      console.info('[status-hq/instagram] using direct resolved Instagram video with embedded audio.');
      return directPrepared;
    }
    console.warn('[status-hq/instagram] direct resolved video had no audio; trying Reel audio recovery.');
  } catch (error) {
    console.warn('[status-hq/instagram] direct resolved video preparation failed; trying Reel audio recovery:', error?.code, error?.message);
  }

  if (directPrepared?.cleanup) {
    await directPrepared.cleanup().catch(() => {});
    directPrepared = null;
  }

  if (!audio) {
    try {
      audio = await resolveInstagramAudio(url);
    } catch (error) {
      console.warn('[status-hq/instagram] Reel audio metadata recovery failed:', error?.code, error?.message);
      const missing = new Error('Instagram Reel audio could not be recovered safely.');
      missing.code = 'INSTAGRAM_AUDIO_NOT_FOUND';
      throw missing;
    }
  }

  const recovered = await prepareWhatsAppStatusHQ({ sourceUrl: url, platform, video: best, audio });
  if (!recovered?.profile?.hasAudio) {
    await recovered?.cleanup?.().catch(() => {});
    const missing = new Error('Instagram Reel Premium+ HQ source still has no audio after recovery.');
    missing.code = 'INSTAGRAM_AUDIO_MISSING_AFTER_RECOVERY';
    throw missing;
  }
  return recovered;
}

async function prepareStatusFromTelegramFile(fileId, { galleryCompatible = false, requireAudio = false } = {}) {
  const telegramVideo = await getTelegramFileSource(fileId);
  const prepared = await prepareWhatsAppStatusHQ({
    sourceUrl: '',
    platform: 'telegram',
    video: telegramVideo,
    audio: null,
    galleryCompatible,
  });

  if (requireAudio && !prepared?.profile?.hasAudio) {
    await prepared?.cleanup?.().catch(() => {});
    const error = new Error('Telegram copy of the Instagram video has no audio track.');
    error.code = 'INSTAGRAM_TELEGRAM_AUDIO_MISSING';
    throw error;
  }

  return prepared;
}

export async function processStatusFromLink(chatId, url, platform, fence = null) {
  let prepared = null;
  const progress = await startStatusProgress(chatId);
  try {
    await sendChatAction(chatId, 'upload_video').catch(() => {});
    prepared = await localMediaLane(() => prepareStatusFromSourceUrl(url, platform), chatId);
    if (cancelled(fence)) {
      await progress.remove();
      return false;
    }
    await progress.complete();
    await sendVideoFileUpload(chatId, prepared.filePath, await statusVideoCaption());
    await progress.remove();
    return true;
  } catch (error) {
    console.error('[status-hq/link] failed:', error?.code, error?.message);
    await progress.remove();
    if (!cancelled(fence)) {
      await sendMessage(chatId, '❌ Status HQ tak dapat disiapkan untuk link ini. Cuba semula kemudian.').catch(() => {});
    }
    return false;
  } finally {
    if (prepared?.cleanup) await prepared.cleanup().catch(() => {});
  }
}

export async function processStatusButton(callbackQuery, context = {}) {
  const action = String(callbackQuery?.data || '');
  if (!action.startsWith(MEDIA_STATUS_HQ)) return false;

  const fence = context.fence || null;
  const chatId = callbackQuery?.message?.chat?.id;
  const userId = callbackQuery?.from?.id;
  const video = callbackQuery?.message?.video || null;
  const videoFileId = video?.file_id;
  const imageFileId = Array.isArray(callbackQuery?.message?.photo)
    ? callbackQuery.message.photo.at(-1)?.file_id
    : '';
  const isImage = Boolean(imageFileId && !videoFileId);
  const fileId = videoFileId || imageFileId;
  const caption = callbackQuery?.message?.caption || '';
  const sourceUrl = callbackSourceUrl(action, MEDIA_STATUS_HQ, caption);
  const sourcePlatform = sourceUrl ? detectPlatform(sourceUrl) : null;
  const gallery = galleryMediaMeta(action, MEDIA_STATUS_HQ);
  const fileSize = Number(video?.file_size || gallery?.fileSize || 0);
  const heavyCandidate = Boolean(!isImage && gallery && videoFileId && shouldUseHeavyWorker({ file_size: fileSize }));
  if (!chatId) return true;

  if (gallery && fileSize > heavyVideoLimitBytes()) {
    await telegram('answerCallbackQuery', {
      callback_query_id: callbackQuery.id,
      text: 'Sorry, you can only upload videos up to 200 MB.',
      show_alert: true,
    }).catch(() => {});
    return true;
  }

  if (heavyCandidate && !heavyWorkerConfigured()) {
    await telegram('answerCallbackQuery', {
      callback_query_id: callbackQuery.id,
      text: '⚠️ Large video worker is not available right now.',
      show_alert: true,
    }).catch(() => {});
    return true;
  }

  const claimed = await claimMediaButtons(callbackQuery);
  if (!claimed) {
    await telegram('answerCallbackQuery', {
      callback_query_id: callbackQuery.id,
      text: 'Pilihan ini dah digunakan. Hantar media semula untuk buat lagi.',
      show_alert: false,
    }).catch(() => {});
    return true;
  }

  await telegram('answerCallbackQuery', { callback_query_id: callbackQuery.id }).catch(() => {});
  if (cancelled(fence)) return true;

  if (heavyCandidate) {
    const progressMessage = await startHeavyStatusProgress(chatId);
    try {
      const baseUrl = String(context.baseUrl || '').replace(/\/$/, '');
      await dispatchHeavyMediaJob({
        chatId,
        userId,
        videoFileId,
        fileSize,
        action: 'status_hq',
        sourceKind: 'gallery',
        progressMessageId: progressMessage?.message_id || 0,
        sourceMessageId: gallery.sourceMessageId,
        completionCallbackUrl: baseUrl ? `${baseUrl}/api/premium-hq-success` : '',
      });
      return { premiumVideoDispatched: true };
    } catch (error) {
      console.error('[status-hq/heavy] dispatch failed:', error?.code, error?.message);
      await removeHeavyProgress(chatId, progressMessage?.message_id);
      if (!cancelled(fence)) {
        await sendMessage(chatId, '❌ Worker video besar tak dapat dimulakan sekarang. Cuba lagi.').catch(() => {});
      }
    }
    return true;
  }

  await sendChatAction(chatId, isImage ? 'upload_document' : 'upload_video').catch(() => {});
  let prepared = null;
  let premiumVideoCompleted = false;
  const progress = await (isImage ? startImageStatusProgress(chatId) : startStatusProgress(chatId));
  try {
    if (!fileId) throw new Error('Media file_id missing from callback message.');

    if (isImage) {
      const telegramImage = await getTelegramFileSource(fileId);
      prepared = await localMediaLane(() => prepareWhatsAppStatusImageHQ({ image: telegramImage }), chatId);
      if (cancelled(fence)) {
        await progress.remove();
        return true;
      }
      await progress.complete();
      await sendDocumentFileUpload(chatId, prepared.filePath, await statusImageCaption(), 'status-hq.jpg');
    } else {
      prepared = await localMediaLane(async () => {
        let sourceError = null;
        let instagramTelegramError = null;

        if (sourcePlatform === 'instagram') {
          try {
            return await prepareStatusFromTelegramFile(fileId, {
              galleryCompatible: Boolean(gallery),
              requireAudio: true,
            });
          } catch (error) {
            instagramTelegramError = error;
            console.warn('[status-hq/instagram] Telegram copy had no usable audio; trying original source recovery:', error?.code, error?.message);
          }
        }

        if (sourceUrl && sourcePlatform) {
          try {
            return await prepareStatusFromSourceUrl(sourceUrl, sourcePlatform);
          } catch (error) {
            sourceError = error;
            console.warn('[status-hq] Original source failed, trying Telegram copy:', error?.code, error?.message);
          }
        }

        if (sourcePlatform === 'instagram' && instagramTelegramError) {
          if (sourceError) throw sourceError;
          throw instagramTelegramError;
        }

        try {
          return await prepareStatusFromTelegramFile(fileId, {
            galleryCompatible: Boolean(gallery),
            requireAudio: false,
          });
        } catch (telegramError) {
          if (sourceError) throw sourceError;
          throw telegramError;
        }
      }, chatId);
      if (cancelled(fence)) {
        await progress.remove();
        return true;
      }
      await progress.complete();
      await sendVideoFileUpload(chatId, prepared.filePath, await statusVideoCaption());
      premiumVideoCompleted = true;
    }

    await progress.remove();
  } catch (error) {
    console.error('[status-hq/button] failed:', error?.code, error?.message);
    await progress.remove();
    if (!cancelled(fence)) {
      await sendMessage(
        chatId,
        isImage
          ? '❌ Status HQ tak dapat disiapkan untuk gambar ini. Hantar gambar semula dan cuba lagi.'
          : '❌ Status HQ tak dapat disiapkan untuk video ini. Hantar video/link semula dan cuba lagi.',
      ).catch(() => {});
    }
  } finally {
    if (prepared?.cleanup) await prepared.cleanup().catch(() => {});
  }
  return premiumVideoCompleted ? { premiumVideoCompleted: true } : true;
}
