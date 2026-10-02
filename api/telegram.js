import { detectPlatform, extractFirstUrl } from '../src/platform.js';
import { sendMessage } from '../src/telegram.js';
import { beginUpdate, captureJobFence, isResetAdmin, resetGlobalFence, resetUserFence } from '../src/recovery.js';
import { adminCommandMenuText, commandMenuText, startText } from '../src/bot/commands.js';
import { handleConnectCommand, processAuditDelete, setMirrorWebhook } from '../src/bot/audit.js';
import { MEDIA_LIVE_WALLPAPER, MEDIA_STATUS_HQ, MEDIA_STATUS_HQ_ANDROID } from '../src/bot/media-actions.js';
import { handleTotalUserCommand, markPremiumHqCompleted, recordUsage } from '../src/bot/stats.js';
import { resetUserHeavyQueue } from '../src/bot/user-job-queue.js';
import { processStatusProfileMenu } from '../src/features/status-hq-menu.js';
import { processStatusAndroidButton } from '../src/features/status-hq-android.js';
import { processStatusButton } from '../src/features/status-hq.js';
import { processLiveWallpaperButton } from '../src/features/live-wallpaper.js';
import { isGalleryVideoTooLarge, processUploadedPhoto, processUploadedVideo } from '../src/features/uploaded-media.js';
import { handleHqLabCommand, processHqLabMessage } from '../src/features/hq-lab.js';
import { processTikTokSlideshowChoice } from '../src/features/tiktok-slideshow.js';
import { handleSupportTestCommand } from '../src/features/support-test.js';
import { handleSupportCommand, processSupportCallback, processSupportMessage } from '../src/features/support.js';
import { handleSupportPerClickCommand } from '../src/features/support-click-report.js';
import { handleLuahRasaCommand, processLuahRasaMessage } from '../src/features/luahrasa.js';
import { handleConnectQuoteCommand, processQuoteFilterCallback } from '../src/features/quote-filter.js';
import { handleCheckMemberCommand } from '../src/features/channel-diagnostic.js';
import { handleResetChannelCommand } from '../src/features/channel-reset.js';
import { enforceChannelGateForCallback, enforceChannelGateForMessage, maybePromptChannelAfterSuccess, processChannelGateCallback } from '../src/features/channel-gate.js';
import { scheduleLinkJob } from '../src/link-queue.js';
import { FRIDAY_SUPPORT_MODE_DONATE, FRIDAY_SUPPORT_MODE_FORCE, FRIDAY_SUPPORT_MODE_NORMAL, claimFridayUsageAttempt, enforceFridaySupportForCallback, enforceFridaySupportForMessage, handleFridaySupportModeCommand, handleFridaySupportStopCommand, markFridayUsageSuccess, processFridaySupportCallback, releaseFridayUsageAttempt } from '../src/support/friday-access.js';
import { enforceDailyForceSupportForCallback, enforceDailyForceSupportForMessage, handleDailyForceSupportCommand, handleStopDailyForceSupportCommand } from '../src/support/daily-force.js';
import { enforceSupportTestimonialGateForCallback, enforceSupportTestimonialGateForMessage } from '../src/support/testimonial-gate.js';

function json(res, status, body) { res.status(status).json(body); }
function isAuthorizedWebhook(req) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  return !expected || req.headers['x-telegram-bot-api-secret-token'] === expected;
}
function requestBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return String(process.env.PUBLIC_BASE_URL).replace(/\/$/, '');
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!forwardedHost) return '';
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  return `${proto}://${forwardedHost}`;
}
function mirrorGroupFromRequest(req) {
  const raw = Array.isArray(req?.query?.mirror_group) ? req.query.mirror_group[0] : req?.query?.mirror_group;
  const value = String(raw || '').trim();
  return /^-?\d+$/.test(value) ? value : '';
}
function commandFromMessage(message) {
  const text = String(message?.text || message?.caption || '').trim();
  return (text.split(/\s+/)[0]?.toLowerCase() || '').split('@')[0];
}
function startPayload(message) {
  const text = String(message?.text || '').trim();
  const parts = text.split(/\s+/);
  if (!parts[0]?.toLowerCase().startsWith('/start')) return '';
  return String(parts[1] || '').trim().toLowerCase();
}
async function markFridaySuccess(userId, label) {
  await markFridayUsageSuccess(userId).catch((error) => {
    console.warn(`[friday-support] ${label} mark failed:`, error?.message);
  });
}
async function recordPremiumHqSuccess(userId, chatId) {
  await recordUsage(userId, 'status_hq');
  await markPremiumHqCompleted(userId);
  await markFridaySuccess(userId, 'premium hq');
  await maybePromptChannelAfterSuccess(chatId, userId);
}

async function processMessage(message, context) {
  const chatId = message?.chat?.id;
  const text = message?.text || message?.caption || '';
  if (!chatId) return;
  const command = commandFromMessage(message);
  if (command === '/connect') return handleConnectCommand(message, context.baseUrl, false);
  if (command === '/disconnect') return handleConnectCommand(message, context.baseUrl, true);
  if (command === '/connectquote') return handleConnectQuoteCommand(message);
  if (command === '/start' && startPayload(message) === 'support') return handleSupportCommand(message, context);
  if (command === '/start' || command === '/help') return sendMessage(chatId, startText(message?.from?.id));
  if (command === '/support') return handleSupportCommand(message, context);
  if (await processSupportMessage(message, context)) return;
  if (await enforceSupportTestimonialGateForMessage(message)) return;
  if (command === '/luahrasa') return handleLuahRasaCommand(message, context);
  if (await processLuahRasaMessage(message, context)) return;
  if (await enforceDailyForceSupportForMessage(message)) return;
  if (await enforceChannelGateForMessage(message)) return;
  if (await handleHqLabCommand(message, context)) return;
  if (await processHqLabMessage(message, context)) return;
  if (Array.isArray(message?.photo) && message.photo.length) {
    if (await enforceFridaySupportForMessage(message)) return;

    const claimed = await claimFridayUsageAttempt(userId);
    if (!claimed && await enforceFridaySupportForMessage(message)) return;

    try {
      const completed = await processUploadedPhoto(message, context);
      if (completed && claimed) await markFridaySuccess(userId, 'gallery photo');
      else if (claimed) await releaseFridayUsageAttempt(userId);
      return completed;
    } catch (error) {
      if (claimed) await releaseFridayUsageAttempt(userId).catch(() => {});
      throw error;
    }
  }
  if (message?.video?.file_id) {
    if (await enforceFridaySupportForMessage(message)) return;

    if (isGalleryVideoTooLarge(message?.video?.file_size)) {
      return processUploadedVideo(message, context);
    }

    const claimed = await claimFridayUsageAttempt(userId);
    if (!claimed && await enforceFridaySupportForMessage(message)) return;

    try {
      const completed = await processUploadedVideo(message, context);
      if (completed && claimed) await markFridaySuccess(userId, 'gallery video');
      else if (claimed) await releaseFridayUsageAttempt(userId);
      return completed;
    } catch (error) {
      if (claimed) await releaseFridayUsageAttempt(userId).catch(() => {});
      throw error;
    }
  }
  const statusMode = command === '/status' || command === 'status';
  const url = extractFirstUrl(text);
  if (!url) {
    await sendMessage(chatId, statusMode ? 'Guna format: /status <link video>' : 'Hantar satu link TikTok, Instagram, Threads, X/Twitter atau YouTube, atau upload video/gambar dari gallery.');
    return;
  }
  const platform = detectPlatform(url);
  if (!platform) {
    await sendMessage(chatId, 'Link ni belum disokong. Buat masa sekarang: TikTok, Instagram, Threads, X/Twitter dan YouTube.');
    return;
  }
  await scheduleLinkJob({ message, context, url, platform, statusMode });
}

async function runWebhookUpdate(update, context) {
  const callbackQuery = update?.callback_query;
  if (callbackQuery) {
    const action = String(callbackQuery?.data || '');
    const userId = callbackQuery?.from?.id;
    const chatId = callbackQuery?.message?.chat?.id;
    if (await processQuoteFilterCallback(callbackQuery)) return;
    if (await processFridaySupportCallback(callbackQuery)) return;
    if (await processChannelGateCallback(callbackQuery)) return;
    if (await processSupportCallback(callbackQuery, context)) return;
    if (await enforceSupportTestimonialGateForCallback(callbackQuery)) return;
    if (await enforceDailyForceSupportForCallback(callbackQuery)) return;
    if (await enforceChannelGateForCallback(callbackQuery)) return;
    if (await enforceFridaySupportForCallback(callbackQuery)) return;
    if (await processAuditDelete(callbackQuery)) return;
    if (await processStatusProfileMenu(callbackQuery, context)) return;
    if (await processStatusAndroidButton(callbackQuery, context)) {
      if (action.startsWith(MEDIA_STATUS_HQ_ANDROID)) {
        await recordUsage(userId, 'status_hq');
        await markFridaySuccess(userId, 'android status');
      }
      return;
    }
    const premiumResult = await processStatusButton(callbackQuery, context);
    if (premiumResult) {
      if (action.startsWith(MEDIA_STATUS_HQ) && premiumResult?.premiumVideoCompleted) await recordPremiumHqSuccess(userId, chatId);
      return;
    }
    if (await processLiveWallpaperButton(callbackQuery, context)) {
      if (action.startsWith(MEDIA_LIVE_WALLPAPER)) {
        await recordUsage(userId, 'live_wallpaper');
        await markFridaySuccess(userId, 'live wallpaper');
      }
      return;
    }
    if (await processTikTokSlideshowChoice(callbackQuery, context)) {
      await recordUsage(userId, 'download');
      await markFridaySuccess(userId, 'slideshow');
    }
    return;
  }
  const message = update?.message ?? update?.edited_message;
  if (message) await processMessage(message, context);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, { ok: true, service: 'telegram-social-downloader', endpoint: 'webhook', mirror_connected: Boolean(mirrorGroupFromRequest(req)), architecture: 'isolated-features-v1', recovery: 'sync-recovery-v3', channel_policy: 'support-promotion-only' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!isAuthorizedWebhook(req)) return json(res, 401, { ok: false, error: 'invalid_webhook_secret' });
  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const decision = beginUpdate(update);
    if (!decision.accept) return json(res, 200, { ok: true, ignored: decision.reason });
    const context = { baseUrl: requestBaseUrl(req), mirrorGroupId: mirrorGroupFromRequest(req) };
    const message = update?.message ?? update?.edited_message;
    const callbackQuery = update?.callback_query;
    const actor = callbackQuery?.from || message?.from;
    const actorChatType = callbackQuery?.message?.chat?.type || message?.chat?.type;
    if (actorChatType === 'private' && actor?.id) await recordUsage(actor.id);
    const command = commandFromMessage(message);
    if (command === '/menu') {
      await sendMessage(message.chat.id, commandMenuText()).catch((error) => console.warn('Menu reply failed:', error?.message));
      return json(res, 200, { ok: true, menu: 'user' });
    }
    if (command === '/menuadmin') {
      const userId = message?.from?.id;
      if (!isResetAdmin(userId)) { await sendMessage(message.chat.id, '❌ /menuadmin hanya untuk admin bot.').catch(() => {}); return json(res, 200, { ok: true, menuadmin: false, reason: 'not_admin' }); }
      if (message?.chat?.type !== 'private') { await sendMessage(message.chat.id, '❌ /menuadmin hanya boleh digunakan dalam private chat bot.').catch(() => {}); return json(res, 200, { ok: true, menuadmin: false, reason: 'private_only' }); }
      await sendMessage(message.chat.id, adminCommandMenuText()).catch((error) => console.warn('Admin menu reply failed:', error?.message));
      return json(res, 200, { ok: true, menuadmin: true });
    }
    if (command === '/forcesupport') { await handleFridaySupportModeCommand(message, FRIDAY_SUPPORT_MODE_FORCE); return json(res, 200, { ok: true, friday_support_mode: 'FORCE' }); }
    if (command === '/donatesupport') { await handleFridaySupportModeCommand(message, FRIDAY_SUPPORT_MODE_DONATE); return json(res, 200, { ok: true, friday_support_mode: 'DONATE' }); }
    if (command === '/normalsupport' || command === '/supportnormal') { await handleFridaySupportModeCommand(message, FRIDAY_SUPPORT_MODE_NORMAL); return json(res, 200, { ok: true, friday_support_mode: 'NORMAL' }); }
    if (command === '/stopforcesupport') { await handleFridaySupportStopCommand(message, FRIDAY_SUPPORT_MODE_FORCE); return json(res, 200, { ok: true, friday_support_stop: 'FORCE' }); }
    if (command === '/stopdonatesupport') { await handleFridaySupportStopCommand(message, FRIDAY_SUPPORT_MODE_DONATE); return json(res, 200, { ok: true, friday_support_stop: 'DONATE' }); }
    if (command === '/stopnormalsupport' || command === '/stopsupportnormal') { await handleFridaySupportStopCommand(message, FRIDAY_SUPPORT_MODE_NORMAL); return json(res, 200, { ok: true, friday_support_stop: 'NORMAL' }); }
    if (command === '/forcesupportdaily') { await handleDailyForceSupportCommand(message); return json(res, 200, { ok: true, daily_force_support: true }); }
    if (command === '/stopforcesupportdaily') { await handleStopDailyForceSupportCommand(message); return json(res, 200, { ok: true, daily_force_support: false }); }
    if (command === '/resetchannel') { await handleResetChannelCommand(message); return json(res, 200, { ok: true, channel_reset: true }); }
    if (command === '/totaluser') { await handleTotalUserCommand(message, context); return json(res, 200, { ok: true, stats: true }); }
    if (command === '/supporttest') { await handleSupportTestCommand(message, context); return json(res, 200, { ok: true, support_test: true }); }
    if (command === '/supportperclick') { await handleSupportPerClickCommand(message, context); return json(res, 200, { ok: true, support_per_click: true }); }
    if (command === '/checkmember') { await handleCheckMemberCommand(message); return json(res, 200, { ok: true, channel_member_diagnostic: true }); }
    if (command === '/reset') {
      resetUserFence(update);
      const queueReset = resetUserHeavyQueue(message?.from?.id);
      await sendMessage(message.chat.id, '♻️ Sesi anda telah direset.\nQueue lama untuk sesi ini telah dibuang dan proses lama ditandakan batal.\nSila hantar link atau video semula.').catch((error) => console.warn('User reset reply failed:', error?.message));
      return json(res, 200, { ok: true, reset: 'user', queue: queueReset });
    }
    if (command === '/resetadmin') {
      const userId = message?.from?.id;
      if (!isResetAdmin(userId)) { await sendMessage(message.chat.id, '❌ /resetadmin hanya untuk owner bot.').catch(() => {}); return json(res, 200, { ok: true, reset: false, reason: 'not_owner' }); }
      if (message?.chat?.type !== 'private') { await sendMessage(message.chat.id, '❌ /resetadmin hanya boleh digunakan dalam private chat bot.').catch(() => {}); return json(res, 200, { ok: true, reset: false, reason: 'private_only' }); }
      resetGlobalFence(update);
      try {
        await setMirrorWebhook(context.baseUrl, '', true);
        await sendMessage(message.chat.id, '♻️ ADMIN RESET selesai.\nPending update lama dibuang, pemantauan group di-clear dan semua proses lama ditandakan batal. Bot kembali ke keadaan bersih.');
      } catch (error) {
        console.error('Admin reset failed:', error?.message);
        await sendMessage(message.chat.id, '❌ Admin reset tak dapat disiapkan sepenuhnya. Cuba sekali lagi.').catch(() => {});
      }
      return json(res, 200, { ok: true, reset: 'admin' });
    }
    context.fence = captureJobFence(update);
    await runWebhookUpdate(update, context);
    return json(res, 200, { ok: true, accepted: true });
  } catch (error) {
    console.error('[webhook/router] error:', error);
    return json(res, 200, { ok: false, handled: true });
  }
}