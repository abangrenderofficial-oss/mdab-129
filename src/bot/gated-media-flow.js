import { MEDIA_LIVE_WALLPAPER, MEDIA_STATUS_HQ, MEDIA_STATUS_HQ_ANDROID } from './media-actions.js';
import { handleHqLabCommand, processHqLabMessage } from '../features/hq-lab.js';
import { processStatusProfileMenu } from '../features/status-hq-menu.js';
import { processStatusAndroidButton } from '../features/status-hq-android.js';
import { processStatusButton } from '../features/status-hq.js';
import { processLiveWallpaperButton } from '../features/live-wallpaper.js';
import { isGalleryVideoTooLarge, processUploadedPhoto, processUploadedVideo } from '../features/uploaded-media.js';
import { TT_SLIDE_SPLIT, TT_SLIDE_VIDEO, processTikTokSlideshowChoice } from '../features/tiktok-slideshow.js';
import { recordUsage } from './stats.js';
import { recordPremiumHqSuccess } from '../support/premium-hq-completion.js';
import {
  claimFridayUsageAttempt,
  enforceFridaySupportForCallback,
  enforceFridaySupportForMessage,
  markFridayUsageSuccess,
  releaseFridayUsageAttempt,
} from '../support/friday-access.js';
import {
  claimDailyForceUsageAttempt,
  enforceDailyForceSupportForCallback,
  enforceDailyForceSupportForMessage,
  markDailyForceUsageSuccess,
  releaseDailyForceUsageAttempt,
} from '../support/daily-force.js';

async function markFridaySuccess(userId, label) {
  await markFridayUsageSuccess(userId).catch((error) => {
    console.warn(`[friday-support] ${label} mark failed:`, error?.message);
  });
}

export async function processHqLabBeforeMedia(message, context = {}) {
  if (await handleHqLabCommand(message, context)) return true;
  if (await processHqLabMessage(message, context)) return true;
  return false;
}

async function claimBoth(userId, messageOrCallback, isCallback = false) {
  const fridayClaimed = await claimFridayUsageAttempt(userId);
  if (!fridayClaimed) {
    const blocked = isCallback
      ? await enforceFridaySupportForCallback(messageOrCallback)
      : await enforceFridaySupportForMessage(messageOrCallback);
    if (blocked) return { blocked: true, fridayClaimed: false, dailyClaimed: false };
  }

  const dailyClaimed = await claimDailyForceUsageAttempt(userId);
  if (!dailyClaimed) {
    const blocked = isCallback
      ? await enforceDailyForceSupportForCallback(messageOrCallback)
      : await enforceDailyForceSupportForMessage(messageOrCallback);
    if (blocked) {
      if (fridayClaimed) await releaseFridayUsageAttempt(userId).catch(() => {});
      return { blocked: true, fridayClaimed, dailyClaimed: false };
    }
  }

  return { blocked: false, fridayClaimed, dailyClaimed };
}

async function releaseClaims(userId, fridayClaimed, dailyClaimed) {
  if (fridayClaimed) await releaseFridayUsageAttempt(userId).catch(() => {});
  if (dailyClaimed) await releaseDailyForceUsageAttempt(userId).catch(() => {});
}

export async function processGalleryUploadWithSupport(message, context = {}) {
  const userId = message?.from?.id;
  if (!userId) return false;

  const isPhoto = Array.isArray(message?.photo) && message.photo.length;
  const isVideo = Boolean(message?.video?.file_id);
  if (!isPhoto && !isVideo) return false;

  if (await enforceFridaySupportForMessage(message)) return true;
  if (await enforceDailyForceSupportForMessage(message)) return true;

  if (isVideo && isGalleryVideoTooLarge(message?.video?.file_size)) {
    await processUploadedVideo(message, context);
    return true;
  }

  const claims = await claimBoth(userId, message, false);
  if (claims.blocked) return true;

  try {
    const completed = isPhoto
      ? await processUploadedPhoto(message, context)
      : await processUploadedVideo(message, context);

    if (completed) {
      if (claims.fridayClaimed) await markFridaySuccess(userId, isPhoto ? 'gallery photo' : 'gallery video');
      if (claims.dailyClaimed) await markDailyForceUsageSuccess(userId, {allowFirstHq:true});
    } else {
      await releaseClaims(userId, claims.fridayClaimed, claims.dailyClaimed);
    }
    return true;
  } catch (error) {
    await releaseClaims(userId, claims.fridayClaimed, claims.dailyClaimed);
    throw error;
  }
}

export async function processMediaCallbackWithSupport(callbackQuery, context = {}) {
  const action = String(callbackQuery?.data || '');
  const userId = callbackQuery?.from?.id;
  const chatId = callbackQuery?.message?.chat?.id;
  if (!userId || !chatId) return false;

  if (await processStatusProfileMenu(callbackQuery, context)) return true;

  const isUsageCallback = action.startsWith(MEDIA_STATUS_HQ_ANDROID)
    || action.startsWith(MEDIA_STATUS_HQ)
    || action.startsWith(MEDIA_LIVE_WALLPAPER)
    || action === TT_SLIDE_SPLIT
    || action === TT_SLIDE_VIDEO;
  if (!isUsageCallback) return false;

  const isPremiumHq = action.startsWith(MEDIA_STATUS_HQ);
  const claims = await claimBoth(userId, callbackQuery, true);
  if (claims.blocked) return true;

  const androidResult = await processStatusAndroidButton(callbackQuery, context);
  if (androidResult) {
    if (action.startsWith(MEDIA_STATUS_HQ_ANDROID)) {
      if (androidResult?.androidHqCompleted) {
        await recordPremiumHqSuccess({
          userId,
          chatId,
          label: 'android hq callback',
          completionKey: `android:callback:${String(callbackQuery?.id || '')}`,
        });
      } else if (androidResult?.androidHqDispatched) {
        // Heavy Android worker reports completion through the existing signed
        // callback only AFTER Telegram media delivery succeeds.
      } else {
        // A failed/invalid Android operation must not use up the free HQ try.
        await releaseClaims(userId, claims.fridayClaimed, claims.dailyClaimed);
      }
    }
    return true;
  }

  const premiumResult = await processStatusButton(callbackQuery, context);
  if (premiumResult) {
    if (isPremiumHq && premiumResult?.premiumHqCompleted) {
      await recordPremiumHqSuccess({
        userId,
        chatId,
        label: 'premium hq callback',
        completionKey: `callback:${String(callbackQuery?.id || '')}`,
      });
    } else if (isPremiumHq && premiumResult?.premiumVideoDispatched) {
      // Keep the Friday/Daily claims until the heavy worker completion callback
      // confirms the Premium+ HQ media was actually delivered.
    } else {
      await releaseClaims(userId, claims.fridayClaimed, claims.dailyClaimed);
    }
    return true;
  }

  if (await processLiveWallpaperButton(callbackQuery, context)) {
    if (action.startsWith(MEDIA_LIVE_WALLPAPER)) {
      await recordUsage(userId, 'live_wallpaper');
      await markFridaySuccess(userId, 'live wallpaper');
      if (claims.dailyClaimed) await markDailyForceUsageSuccess(userId).catch(() => {});
    }
    return true;
  }

  if (await processTikTokSlideshowChoice(callbackQuery, context)) {
    await recordUsage(userId, 'download');
    await markFridaySuccess(userId, 'slideshow');
    if (claims.dailyClaimed) await markDailyForceUsageSuccess(userId).catch(() => {});
    return true;
  }

  await releaseClaims(userId, claims.fridayClaimed, claims.dailyClaimed);
  return false;
}
