// Free + Share gate (PayPing Access Mode). Runs beside the channel gate and only
// when PayPing has MediaX on Free + Share. Only a NEW source (link, photo or video)
// can be locked; Premium + HQ / Android HQ for media already delivered stays usable,
// so one completed use = one source plus its HQ conversion.
import { uploadedPhoto } from '../bot/uploaded-photo.js';
import { uploadedVideo } from '../bot/uploaded-video.js';
import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import { hasCompletedUse } from '../bot/stats.js';
import { getActiveSupporterTitle } from '../support/community-store.js';
import {
  SHARE_CHECK_CALLBACK,
  getMediaXShareRule,
  shareState,
  unlockShare,
  inviteCode,
  shareLockMessage,
  shareNoticeText,
  recordShareInviteJoin,
  recordShareUse,
} from '../support/payping-share.js';

let botUsernamePromise = null;
async function botUsername() {
  const configured = String(process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@+/, '');
  if (configured) return configured;
  if (!botUsernamePromise) {
    botUsernamePromise = telegram('getMe', {})
      .then((bot) => String(bot?.username || '').trim().replace(/^@+/, ''))
      .catch((error) => { botUsernamePromise = null; console.warn('[share-gate] getMe failed:', error?.message); return ''; });
  }
  return botUsernamePromise;
}

async function inviteLinkFor(userId) {
  const [username, code] = await Promise.all([botUsername(), inviteCode(userId)]);
  return username && code ? `https://t.me/${username}?start=inv_${code}` : '';
}

function isNewSource(message = {}) {
  // Photos and videos, including ones sent as original-quality documents.
  if (uploadedPhoto(message)) return true;
  if (uploadedVideo(message)) return true;
  return /https?:\/\/\S+/i.test(String(message?.text || message?.caption || ''));
}

async function isSupporter(userId) {
  try { return Boolean(await getActiveSupporterTitle(userId)); } catch { return false; }
}

const notifyInviter = (chatId, text) => sendMessage(Number(chatId), text, { parse_mode: 'HTML', disable_web_page_preview: true });

/** /start inv_CODE — remember who invited this person (counted after their first completed use). */
export async function handleShareStartPayload(message = {}, payload = '') {
  const user = message?.from || {};
  if (!user.id || !String(payload).toLowerCase().startsWith('inv_')) return false;
  try {
    const knownUser = await hasCompletedUse(user.id);
    return await recordShareInviteJoin({ inviteeId: user.id, code: String(payload).slice(4), inviteeName: user.first_name || '', knownUser });
  } catch (error) {
    console.warn('[share-gate] invite join failed:', error?.message);
    return false;
  }
}

/** Call after a link/upload delivered its media. key identifies that source message. */
export async function recordShareCompletedUse(userId, key) {
  try { return await recordShareUse(userId, key, { notify: notifyInviter }); }
  catch (error) { console.warn('[share-gate] completed use not saved:', error?.message); return null; }
}

/** Blocks a new link/photo/video once the free uses are spent and friends are still missing. */
export async function enforceShareGateForMessage(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId || message?.chat?.type !== 'private' || isResetAdmin(userId)) return false;
  if (!isNewSource(message)) return false;
  try {
    const rule = await getMediaXShareRule();
    if (!rule) return false;
    const state = await shareState(userId, rule);
    if (!state) return false;
    if (state.canUnlock) {
      await unlockShare(userId, rule);
      await sendMessage(chatId, await shareNoticeText('unlocked', rule, { firstName: message.from.first_name, invited: state.invited }), { parse_mode: 'HTML' }).catch(() => {});
      return false;
    }
    if (!state.needsShare || await isSupporter(userId)) return false;
    const { text, extra } = await shareLockMessage(message.from, rule, state, await inviteLinkFor(userId));
    await sendMessage(chatId, text, extra);
    return true;
  } catch (error) {
    // Never lock people out because the shared database is briefly unreachable.
    console.warn('[share-gate] check failed; allowing request:', error?.message);
    return false;
  }
}

/** “🔄 Semak Progress” button on the lock message. */
export async function processShareGateCallback(callbackQuery = {}) {
  if (String(callbackQuery?.data || '') !== SHARE_CHECK_CALLBACK) return false;
  const userId = callbackQuery?.from?.id;
  const chatId = callbackQuery?.message?.chat?.id;
  const answer = (text, alert = false) => telegram('answerCallbackQuery', { callback_query_id: callbackQuery.id, text, show_alert: alert }).catch(() => {});
  if (!userId || !chatId) return true;
  try {
    const rule = await getMediaXShareRule({ fresh: true });
    if (!rule) { await answer('Boleh guna bot macam biasa sekarang 😊'); return true; }
    const state = await shareState(userId, rule);
    if (state.unlocked || state.canUnlock) {
      if (state.canUnlock) await unlockShare(userId, rule);
      await answer('Dah terbuka ✅');
      const text = await shareNoticeText('unlocked', rule, { firstName: callbackQuery.from.first_name, invited: rule.needed });
      await telegram('editMessageText', { chat_id: chatId, message_id: callbackQuery.message.message_id, text, parse_mode: 'HTML' })
        .catch(() => sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => {}));
      return true;
    }
    await answer(`Progress: ${state.invited}/${rule.needed} · tinggal ${state.remaining} kawan lagi. Kawan dikira lepas dia guna bot sekali.`, true);
    const { text, extra } = await shareLockMessage(callbackQuery.from, rule, state, await inviteLinkFor(userId));
    await telegram('editMessageText', { chat_id: chatId, message_id: callbackQuery.message.message_id, text, ...extra }).catch(() => {});
  } catch (error) {
    console.warn('[share-gate] progress check failed:', error?.message);
    await answer('Tak dapat semak sekarang. Cuba lagi kejap ya.', true);
  }
  return true;
}
