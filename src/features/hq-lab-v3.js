// Owner-only experimental /hqlab picker. Production and protected HQ encoders untouched.
import { randomBytes } from 'node:crypto';
import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';

const STATE_KEY = Symbol.for('abangrender.downloader.hqlab.owner-picker.v2');
const SESSION_TTL_MS = 15 * 60_000;
const PICKER_TTL_MS = 30 * 60_000;
const MAX_DOCUMENT_BYTES = 500 * 1024 * 1024;
const CALLBACK_PREFIX = 'hq3';

const FORMULAS = Object.freeze({
  cplus: { label: 'C+ HQ', button: '1. C+ HQ' },
  premiumplus: { label: 'Premium+ HQ Old', button: '2. Premium+ HQ Old' },
  'premiumplus-v2': { label: 'Premium+ HQ V2', button: '3. Premium+ HQ V2' },
  'v3-old': { label: 'Premium+ HQ V3 Old (H.264)', button: '4. V3 Old · H.264 / 10 MB' },
  'v3-new': { label: 'Premium+ HQ V3 Quality First', button: '5. V3 NEW · H.265 Slow CRF18' },
});

function store() {
  if (!globalThis[STATE_KEY]) {
    globalThis[STATE_KEY] = { sessions: new Map(), prompts: new Map() };
  }
  return globalThis[STATE_KEY];
}

function ownerOnly(message) {
  const userId = String(message?.from?.id || '');
  const ownerId = String(process.env.BOT_OWNER_ID || '').trim();
  return Boolean(ownerId && ownerId === userId && isResetAdmin(userId) &&
    message?.chat?.type === 'private' && String(message?.chat?.id || '') === userId);
}

function originalLabSessions() {
  const symbol = Symbol.for('abangrender.downloader.hq-lab.v1');
  if (!globalThis[symbol]) globalThis[symbol] = new Map();
  return globalThis[symbol];
}

function clearOriginalSession(ownerMessage) {
  originalLabSessions().delete(String(ownerMessage.chat.id) + ':' + String(ownerMessage.from.id));
}

function clearOwnerPrompts(chatId) {
  for (const [nonce, prompt] of store().prompts) {
    if (String(prompt.chatId) === String(chatId)) store().prompts.delete(nonce);
  }
}

function cleanExpired() {
  const now = Date.now();
  for (const [id, expiresAt] of store().sessions) {
    if (Number(expiresAt || 0) <= now) store().sessions.delete(id);
  }
  for (const [nonce, prompt] of store().prompts) {
    if (prompt.expiresAt <= now) store().prompts.delete(nonce);
  }
}

function command(message) {
  const word = String(message?.text || '').trim().toLowerCase().split(/\s+/)[0] || '';
  return word.split('@')[0];
}

function videoDocument(document) {
  if (!document?.file_id) return false;
  const mime = String(document?.mime_type || '').toLowerCase().split(';')[0].trim();
  return mime.startsWith('video/') ||
    /\.(mp4|mov|m4v|mkv|webm|avi|mts|m2ts|mpeg|mpg|3gp|3g2)$/i.test(String(document?.file_name || ''));
}

function videoFromMessage(message) {
  if (videoDocument(message?.document)) return message.document;
  if (message?.video?.file_id) return message.video;
  return null;
}

export function ownerHqLabMenuText() {
  return [
    '🧪 HQ Lab — Owner Only',
    '',
    'Send a video as Gallery upload or File / Document (2K / 4K supported).',
    'After you send the video, choose ONE compression formula from five buttons.',
    '',
    '1. C+ HQ',
    '2. Premium+ HQ Old',
    '3. Premium+ HQ V2',
    '4. Premium+ HQ V3 Old — H.264 / up to 10 MB',
    '5. Premium+ HQ V3 NEW — H.265 Slow CRF18 / Quality First',
    '',
    'Only the selected formula will run.',
    'V3 NEW preserves source FPS; output size is quality-driven, not forced to 10 MB.',
    'Maximum input for this test: 500 MiB.',
    'Use /hqlab off to close.',
    'Production Premium+ HQ is unchanged.',
  ].join('\n');
}

function keyboard(nonce) {
  return {
    inline_keyboard: Object.entries(FORMULAS).map(([slug, info]) => [
      { text: info.button, callback_data: CALLBACK_PREFIX + ':' + nonce + ':' + slug },
    ]),
  };
}

function callbackData(raw) {
  const match = String(raw || '').match(/^hq3:([0-9a-f]{12}):(cplus|premiumplus|premiumplus-v2|v3-old|v3-new)$/);
  return match ? { nonce: match[1], formula: match[2] } : null;
}

async function dispatch({ chatId, userId, fileId, fileSize, formula }) {
  const token = String(process.env.GITHUB_ACTIONS_TOKEN || process.env.GH_ACTIONS_TOKEN || '').trim();
  if (!token) throw new Error('GitHub worker belum dikonfigurasi.');
  const owner = String(process.env.GITHUB_WORKER_OWNER || 'abangrenderofficial-oss').trim();
  const repo = String(process.env.GITHUB_WORKER_REPO || 'mdab-129').trim();
  const apiUrl = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' +
    encodeURIComponent(repo) + '/actions/workflows/hqlab-v3.yml/dispatches';
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: {
        chat_id: String(chatId),
        user_id: String(userId),
        file_id: String(fileId),
        file_size: String(fileSize || 0),
        formula,
      },
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (response.status !== 204) {
    throw new Error('HQ Lab worker rejected the selected formula (HTTP ' + response.status + ').');
  }
}

export async function processOwnerHqLabV3(message) {
  if (!ownerOnly(message)) return false;
  cleanExpired();
  const chatId = message.chat.id;
  const sessionKey = String(chatId);
  const cmd = command(message);
  const raw = String(message?.text || '').trim().toLowerCase();

  if (cmd === '/hqlab') {
    if (/^\/hqlab(?:@\w+)?\s+(?:off|stop|cancel|batal|v3\s+off)$/.test(raw)) {
      store().sessions.delete(sessionKey);
      clearOwnerPrompts(chatId);
      clearOriginalSession(message);
      await sendMessage(chatId, '🧪 HQ Lab closed.').catch(() => {});
      return true;
    }
    if (/^\/hqlab(?:@\w+)?(?:\s+v3)?$/.test(raw)) {
      clearOriginalSession(message);
      clearOwnerPrompts(chatId);
      store().sessions.set(sessionKey, Date.now() + SESSION_TTL_MS);
      await sendMessage(chatId, ownerHqLabMenuText());
      return true;
    }
    return false;
  }

  if (!store().sessions.has(sessionKey)) return false;
  if (cmd.startsWith('/')) return false;

  const video = videoFromMessage(message);
  if (!video) {
    await sendMessage(chatId, '🧪 Please upload a video first. HQ Lab will show formula buttons after receiving your video.').catch(() => {});
    return true;
  }
  const fileSize = Number(video.file_size || 0);
  if (fileSize > MAX_DOCUMENT_BYTES) {
    await sendMessage(chatId, '❌ Video exceeds HQ Lab test input limit of 500 MiB.').catch(() => {});
    return true;
  }

  const nonce = randomBytes(6).toString('hex');
  const info = {
    chatId: String(chatId),
    ownerId: String(message.from.id),
    fileId: String(video.file_id),
    fileSize,
    sourceMessageId: Number(message.message_id || 0),
    status: 'waiting',
    menuMessageId: 0,
    expiresAt: Date.now() + PICKER_TTL_MS,
  };
  // Store before sending so callback handlers cannot race the UI.
  store().prompts.set(nonce, info);
  try {
    const sent = await sendMessage(
      chatId,
      '🧪 HQ Lab — Video received.\n\nChoose ONE formula to process this video:',
      { reply_markup: keyboard(nonce) },
    );
    info.menuMessageId = Number(sent?.message_id || 0);
    if (!info.menuMessageId) throw new Error('Telegram did not confirm formula picker message.');
    // Leave /hqlab mode active for another upload until its TTL expires.
    store().sessions.set(sessionKey, Date.now() + SESSION_TTL_MS);
    return true;
  } catch (error) {
    store().prompts.delete(nonce);
    console.error('[hqlab/picker] menu failed:', error?.message);
    await sendMessage(chatId, '❌ HQ Lab could not show the formula buttons. Please resend the video.').catch(() => {});
    return true;
  }
}

export async function processOwnerHqLabChoiceCallback(query) {
  if (!String(query?.data || '').startsWith(CALLBACK_PREFIX + ':')) return false;
  cleanExpired();
  const chatId = query?.message?.chat?.id;
  const userId = query?.from?.id;
  const message = { from: { id: userId }, chat: query?.message?.chat };
  const answer = async (text, alert = false) => {
    await telegram('answerCallbackQuery', {
      callback_query_id: query?.id,
      text,
      show_alert: alert,
    }).catch(() => {});
  };
  if (!ownerOnly(message)) {
    await answer('HQ Lab is available only to the bot owner.', true);
    return true;
  }

  const parsed = callbackData(query.data);
  const prompt = parsed ? store().prompts.get(parsed.nonce) : null;
  if (!parsed || !prompt || prompt.status !== 'waiting' ||
      prompt.ownerId !== String(userId) ||
      prompt.chatId !== String(chatId) ||
      prompt.menuMessageId !== Number(query?.message?.message_id || 0)) {
    await answer('This formula menu is expired or already used. Send /hqlab again.', true);
    return true;
  }

  // Consume synchronously before any awaited call, preventing duplicate dispatches.
  prompt.status = 'dispatching';
  await answer('Starting ' + FORMULAS[parsed.formula].label + '...');
  await telegram('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: prompt.menuMessageId,
    reply_markup: { inline_keyboard: [] },
  }).catch(() => {});

  try {
    await dispatch({
      chatId, userId,
      fileId: prompt.fileId,
      fileSize: prompt.fileSize,
      formula: parsed.formula,
    });
    prompt.status = 'dispatched';
    await telegram('editMessageText', {
      chat_id: chatId,
      message_id: prompt.menuMessageId,
      text: '✅ Selected formula: ' + FORMULAS[parsed.formula].label +
        '\n\nYour video has been sent for encoding. Only this formula will run.',
    }).catch(() => {});
  } catch (error) {
    console.error('[hqlab/picker] dispatch failed:', error?.message);
    prompt.status = 'waiting';
    await telegram('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: prompt.menuMessageId,
      reply_markup: keyboard(parsed.nonce),
    }).catch(() => {});
    await sendMessage(chatId,
      '❌ HQ Lab could not start ' + FORMULAS[parsed.formula].label +
      '. ' + (error?.message || 'Try again.')).catch(() => {});
  }
  return true;
}
