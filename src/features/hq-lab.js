import { extractFirstUrl, detectPlatform } from '../platform.js';
import { getTelegramFileSource, sendChatAction, sendMessage, sendVideoFileUpload } from '../telegram.js';
import { isResetAdmin } from '../recovery.js';
import { chooseBestVideo, resolveMedia } from '../bot/media-resolver.js';
import { localMediaLane } from '../bot/job-lanes.js';
import { prepareHqLab } from '../hq-lab.js';

const STATE_KEY = Symbol.for('abangrender.downloader.hq-lab.v1');
const LAB_TTL_MS = 15 * 60_000;

function state() {
  if (!globalThis[STATE_KEY]) globalThis[STATE_KEY] = new Map();
  return globalThis[STATE_KEY];
}

function stateKey(message) {
  return `${String(message?.chat?.id || '')}:${String(message?.from?.id || '')}`;
}

function isPrivateOwner(message) {
  return message?.chat?.type === 'private' && isResetAdmin(message?.from?.id);
}

function commandFromMessage(message) {
  const text = String(message?.text || message?.caption || '').trim();
  const token = text.split(/\s+/)[0]?.toLowerCase() || '';
  return token.split('@')[0];
}

function activeLab(message) {
  if (!isPrivateOwner(message)) return false;
  const key = stateKey(message);
  const value = state().get(key);
  if (!value) return false;
  if (Date.now() > Number(value.expiresAt || 0)) {
    state().delete(key);
    return false;
  }
  return true;
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '-';
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatFps(value) {
  const fps = Number(value || 0);
  if (!fps) return '-';
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(2);
}


async function dispatchOwnerV3Document({ chatId, userId, document }) {
  const token = String(process.env.GITHUB_ACTIONS_TOKEN || process.env.GH_ACTIONS_TOKEN || '').trim();
  if (!token) throw new Error('GitHub Actions worker belum dikonfigurasi.');
  const owner = String(process.env.GITHUB_WORKER_OWNER || 'abangrenderofficial-oss').trim();
  const repo = String(process.env.GITHUB_WORKER_REPO || 'mdab-129').trim();
  // Only the dedicated owner HQ Lab workflow on main; no production-worker changes.
  const endpoint = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' +
    encodeURIComponent(repo) + '/actions/workflows/hqlab-v3.yml/dispatches';
  const response = await fetch(endpoint, {
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
        file_id: String(document.file_id),
        file_size: String(Number(document.file_size || 0)),
      },
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    throw new Error('HQ Lab V3 worker dispatch gagal (HTTP ' + response.status + ').');
  }
}

function isV3VideoDocument(document) {
  const mime = String(document?.mime_type || '').split(';')[0].trim().toLowerCase();
  const filename = String(document?.file_name || '');
  return Boolean(document?.file_id) && (
    mime.startsWith('video/') ||
    /\.(mp4|mov|m4v|mkv|webm|avi|mts|m2ts|mpeg|mpg|3gp)$/i.test(filename)
  );
}

function resultCaption(result, burnLabel) {
  const output = result?.output || {};
  const displayName = result?.id === 'PREMIUM+' ? 'Premium + HQ old' : `${result.id} — ${result.name}`;
  return [
    `🧪 ${displayName}`,
    output.width && output.height ? `📐 ${output.width} × ${output.height}` : null,
    output.fps ? `🎞 ${formatFps(output.fps)} fps` : null,
    output.hasAudio ? '🔊 Audio: ada' : '🔇 Audio: tiada pada source',
    `📊 Target video: ${result.videoKbps} kbps`,
    `📦 ${formatSize(result.size)}`,
    `⚡ Encode: ${(Number(result.elapsedMs || 0) / 1000).toFixed(1)}s`,
    burnLabel ? '🏷️ Label test dibakar pada video' : '🏷️ Label: caption sahaja (drawtext runtime tak tersedia)',
  ].filter(Boolean).join('\n').slice(0, 1024);
}

async function resolveLabInput(message) {
  const uploadedFileId = message?.video?.file_id
    || (String(message?.document?.mime_type || '').startsWith('video/') ? message.document.file_id : '');
  if (uploadedFileId) {
    const video = await getTelegramFileSource(uploadedFileId);
    return { sourceUrl: '', platform: 'telegram', video, audio: null };
  }

  const url = extractFirstUrl(message?.text || message?.caption || '');
  if (!url) return null;
  const platform = detectPlatform(url);
  if (!platform) {
    const error = new Error('Link ini belum disokong oleh HQ Lab.');
    error.code = 'HQ_LAB_UNSUPPORTED_LINK';
    throw error;
  }
  if (platform === 'youtube') return { sourceUrl: url, platform, video: null, audio: null };

  const media = await resolveMedia(platform, url);
  const video = chooseBestVideo(media?.videos || []);
  if (!video) {
    const error = new Error('HQ Lab tak jumpa video pada link ini.');
    error.code = 'HQ_LAB_VIDEO_NOT_FOUND';
    throw error;
  }
  const audio = Array.isArray(media?.audios)
    ? media.audios.find((item) => item?.url) || null
    : null;
  return { sourceUrl: url, platform, video, audio };
}

export async function handleHqLabCommand(message) {
  if (commandFromMessage(message) !== '/hqlab') return false;
  if (!isPrivateOwner(message)) return true;

  const chatId = message.chat.id;
  const raw = String(message?.text || '').trim().toLowerCase();
  if (/\s+(?:off|stop|cancel|batal)$/.test(raw)) {
    state().delete(stateKey(message));
    await sendMessage(chatId, '🧪 HQ Lab ditutup.').catch(() => {});
    return true;
  }

  const mode = /^\/hqlab(?:@\w+)?\s+v3$/.test(raw) ? 'v3' : 'compare';
  state().set(stateKey(message), { expiresAt: Date.now() + LAB_TTL_MS, mode });
  if (mode === 'v3') {
    await sendMessage(chatId, [
      '🧪 HQ Lab Premium+ HQ V3 — owner sahaja.',
      'Hantar video 2K / 4K sebagai File / Document (MP4, MOV, MKV, dll).',
      'V3 output: sehingga 1080p • 60 FPS • bitrate sehingga 10 Mbps • maksimum 10 MB.',
      'Untuk video panjang, bitrate akan diturunkan supaya fail kekal ≤10 MB.',
      'Fail siap dihantar semula sebagai MP4 Document supaya compression tidak berubah.',
      'Maksimum input untuk ujian V3: 500 MiB. /hqlab off untuk batal.',
      'Formula Premium+ HQ production dan HQ Lab lama tidak diubah.',
    ].join('\n'));
    return true;
  }
  await sendMessage(
    chatId,
    [
      '🧪 HQ Lab aktif — hanya untuk owner.',
      '',
      'Sekarang hantar SATU:',
      '• link TikTok / Reels / Threads / X / YouTube',
      '• atau upload satu video dari Gallery',
      '',
      'Bot akan hasilkan 3 versi dari source yang sama:',
      'C+ HQ • Premium + HQ old • Premium+ HQ V2',
      '',
      'C+ = resepi C+ HQ sedia ada.',
      'Premium + HQ old = formula Premium+ HQ asal.',
      'Premium+ HQ V2 = enhancement 100% sama seperti Premium+; encoder/bitrate V2 kekal.',
      '',
      'Audio source akan dipulihkan sekali jika platform beri video dan audio berasingan.',
      'Upload ketiga-tiga ke WhatsApp Status dan compare selepas WhatsApp compress.',
      'Ujian Premium+ HQ V3 (Document 2K/4K): /hqlab v3',
      'Taip /hqlab off untuk batal.',
    ].join('\n'),
  );
  return true;
}

export async function processHqLabMessage(message, context = {}) {
  if (!activeLab(message)) return false;
  if (commandFromMessage(message).startsWith('/')) return false;

  const chatId = message?.chat?.id;
  if (!chatId) return false;

  if (state().get(stateKey(message))?.mode === 'v3') {
    const document = message?.document;
    if (!isV3VideoDocument(document)) {
      await sendMessage(chatId, '🧪 HQ Lab V3 tunggu video yang dihantar sebagai File / Document (bukan Telegram video biasa).').catch(() => {});
      return true;
    }
    if (Number(document.file_size || 0) > 500 * 1024 * 1024) {
      await sendMessage(chatId, '❌ Document melebihi had ujian V3 500 MiB.').catch(() => {});
      return true;
    }
    try {
      await dispatchOwnerV3Document({ chatId, userId: message.from.id, document });
      state().delete(stateKey(message));
      await sendMessage(chatId, '🧪 Premium+ HQ V3 dihantar ke worker khas. Hasil MP4 Document akan dihantar di sini apabila encoding berjaya. Production HQ tidak terjejas.').catch(() => {});
    } catch (error) {
      console.error('[hqlab/v3] dispatch failed:', error?.message);
      await sendMessage(chatId, '❌ ' + (error?.message || 'HQ Lab V3 tidak dapat dimulakan.')).catch(() => {});
    }
    return true;
  }

  let input;
  try {
    input = await resolveLabInput(message);
  } catch (error) {
    await sendMessage(chatId, `❌ ${error?.message || 'HQ Lab tak dapat baca input ini.'}`).catch(() => {});
    return true;
  }
  if (!input) {
    await sendMessage(chatId, 'HQ Lab tunggu link video atau upload video dari Gallery.').catch(() => {});
    return true;
  }

  state().delete(stateKey(message));
  await sendMessage(chatId, '🧪 HQ Lab sedang buat 3 versi: C+ HQ, Premium + HQ old dan Premium+ HQ V2. Production user lain tak terjejas.').catch(() => {});
  await sendChatAction(chatId, 'upload_video').catch(() => {});

  let prepared = null;
  try {
    prepared = await localMediaLane(() => prepareHqLab(input));
    const successes = prepared.results.filter((item) => item.ok);
    const failures = prepared.results.filter((item) => !item.ok);
    const total = prepared.results.length;

    for (const result of successes) {
      await sendChatAction(chatId, 'upload_video').catch(() => {});
      await sendVideoFileUpload(chatId, result.filePath, resultCaption(result, prepared.burnLabel));
    }

    if (failures.length) {
      await sendMessage(
        chatId,
        `⚠️ HQ Lab siap ${successes.length}/${total}. Gagal: ${failures.map((item) => `${item.id} ${item.name}`).join(', ')}.`,
      ).catch(() => {});
    } else {
      await sendMessage(
        chatId,
        `✅ HQ Lab siap: C+ HQ, Premium + HQ old dan Premium+ HQ V2. Audio source: ${prepared.source?.hasAudio ? 'ada ✅' : 'tiada'}. Upload semua ke WhatsApp Status dan compare detail, naturalness dan motion selepas compression.`,
      ).catch(() => {});
    }
  } catch (error) {
    console.error('[hq-lab] failed:', error?.code, error?.message);
    await sendMessage(chatId, '❌ HQ Lab tak dapat disiapkan untuk source ini. Production Status HQ tidak disentuh.').catch(() => {});
  } finally {
    if (prepared?.cleanup) await prepared.cleanup().catch(() => {});
  }
  return true;
}
