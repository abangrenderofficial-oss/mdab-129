// Owner-only experimental HQ Lab V3; independent of protected production encoders.
import { sendMessage } from '../telegram.js';
import { isResetAdmin } from '../recovery.js';

const STATE_KEY = Symbol.for('abangrender.downloader.hqlab.v3.owner.v1');
const LAB_TTL_MS = 60 * 60_000;
const MAX_DOCUMENT_BYTES = 500 * 1024 * 1024;

function sessions() {
  if (!globalThis[STATE_KEY]) globalThis[STATE_KEY] = new Map();
  return globalThis[STATE_KEY];
}

function ownerOnly(message) {
  const id = String(message?.from?.id || '');
  const expected = String(process.env.BOT_OWNER_ID || '').trim();
  return Boolean(expected && id === expected && isResetAdmin(id) &&
    message?.chat?.type === 'private' && String(message?.chat?.id || '') === id);
}

function command(message) {
  const value = String(message?.text || '').trim().toLowerCase();
  return value.split(/\s+/)[0].split('@')[0];
}

function videoDocument(document) {
  const mime = String(document?.mime_type || '').split(';')[0].trim().toLowerCase();
  const filename = String(document?.file_name || '');
  return Boolean(document?.file_id) && (
    mime.startsWith('video/') ||
    /\.(mp4|mov|m4v|mkv|webm|avi|mts|m2ts|mpeg|mpg|3gp)$/i.test(filename)
  );
}

async function dispatch({ chatId, userId, document }) {
  const token = String(process.env.GITHUB_ACTIONS_TOKEN || process.env.GH_ACTIONS_TOKEN || '').trim();
  if (!token) throw new Error('GitHub Actions worker belum dikonfigurasi.');
  const owner = String(process.env.GITHUB_WORKER_OWNER || 'abangrenderofficial-oss').trim();
  const repo = String(process.env.GITHUB_WORKER_REPO || 'mdab-129').trim();
  const url = 'https://api.github.com/repos/' + encodeURIComponent(owner) +
    '/' + encodeURIComponent(repo) + '/actions/workflows/hqlab-v3.yml/dispatches';
  const response = await fetch(url, {
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
    throw new Error('Worker HQ Lab V3 gagal dimulakan (HTTP ' + response.status + ').');
  }
}

// Match the legacy /hqlab 15-minute session WITHOUT changing protected HQ Lab code.
function originalLabSessions() {
  const symbol = Symbol.for('abangrender.downloader.hq-lab.v1');
  if (!globalThis[symbol]) globalThis[symbol] = new Map();
  return globalThis[symbol];
}

function setOriginalSession(message) {
  const key = String(message.chat.id) + ':' + String(message.from.id);
  originalLabSessions().set(key, { expiresAt: Date.now() + 15 * 60_000 });
}

function clearOriginalSession(message) {
  const key = String(message.chat.id) + ':' + String(message.from.id);
  originalLabSessions().delete(key);
}

export function ownerHqLabMenuText() {
  return [
    '🧪 HQ Lab aktif — hanya untuk owner.',
    '',
    '5 formula ujian dalam HQ Lab:',
    '1. C+ HQ (asal)',
    '2. Premium + HQ Old (asal)',
    '3. Premium+ HQ V2 (asal)',
    '4. Premium+ HQ V3 OLD — H.264 Veryfast',
    '5. ✨ Premium+ HQ V3 NEW — H.265 Slow Two-Pass',
    '',
    'V3 OLD vs NEW: maksimum 1080p • 60 FPS • bitrate sehingga 10 Mbps • fail ≤10 MB.',
    '',
    'Hantar SATU sumber:',
    '• Video biasa dari Gallery: 3 formula asal + V3 OLD & NEW.',
    '• Video 2K / 4K sebagai File / Document: V3 OLD & NEW melalui worker khas. Jika fail ≤20 MB dan disokong, 3 formula asal turut dijalankan.',
    '• Link TikTok / Reels / Threads / X / YouTube: 3 formula asal (V3 perlukan fail video yang diupload).',
    '',
    'Kedua-dua V3 dihantar sebagai MP4 Document untuk banding side-by-side.',
    'V3 NEW: SSIM quality check; jika tak lepas had kualiti/saiz, bot akan maklumkan kegagalan.',
    'Had input V3: 500 MiB.',
    'Taip /hqlab off untuk tutup.',
    'Formula Premium+ HQ production tidak diubah.',
  ].join('\n');
}

export async function processOwnerHqLabV3(message) {
  if (!ownerOnly(message)) return false;
  const chatId = message.chat.id;
  const key = String(chatId);
  const raw = String(message?.text || '').trim().toLowerCase();
  const cmd = command(message);
  const active = Number(sessions().get(key) || 0) > Date.now();

  if (cmd === '/hqlab') {
    if (/^\/hqlab(?:@\w+)?\s+(?:off|stop|cancel|batal|v3\s+off)$/.test(raw)) {
      sessions().delete(key);
      clearOriginalSession(message);
      await sendMessage(chatId, '🧪 HQ Lab ditutup.').catch(() => {});
      return true;
    }
    // Existing /hqlab and /hqlab v3 both open the SAME four-formula lab.
    if (/^\/hqlab(?:@\w+)?(?:\s+v3)?$/.test(raw)) {
      sessions().set(key, Date.now() + 15 * 60_000);
      setOriginalSession(message);
      await sendMessage(chatId, ownerHqLabMenuText()).catch(() => {});
      return true;
    }
    return false;
  }

  if (!active) {
    sessions().delete(key);
    return false;
  }
  if (cmd.startsWith('/')) return false;

  const document = message?.document;
  const video = message?.video;
  const input = videoDocument(document) ? document : (video?.file_id ? video : null);
  if (!input) {
    // Links and other valid legacy inputs proceed to the three original HQ Lab formulas.
    sessions().delete(key);
    return false;
  }
  if (Number(input.file_size || 0) > MAX_DOCUMENT_BYTES) {
    await sendMessage(chatId, '❌ Video melebihi had ujian V3 500 MiB.').catch(() => {});
    return true;
  }

  try {
    await dispatch({ chatId, userId: message.from.id, document: input });
    sessions().delete(key);
    await sendMessage(chatId,
      '🧪 HQ Lab diterima: worker V3 OLD (H.264) dan V3 NEW (H.265 Slow two-pass) akan proses video yang sama. Kedua-duanya dihantar sebagai MP4 Document jika berjaya.'
    ).catch(() => {});
  } catch (error) {
    console.error('[hqlab/v3] dispatch failed:', error?.message);
    await sendMessage(chatId, '❌ ' + (error?.message || 'HQ Lab V3 gagal dimulakan.')).catch(() => {});
    // Keep session active to retry with a new document.
    return true;
  }

  // The existing three lab formulas are left byte-identical, and still run for
  // manageable uploads. Large Documents need MTProto and therefore V3 only.
  const fileSize = Number(input.file_size || 0);
  const legacyAcceptsDoc = !document || String(document.mime_type || '').startsWith('video/');
  if (fileSize && fileSize <= 20 * 1024 * 1024 && legacyAcceptsDoc) return false;
  clearOriginalSession(message);
  if (document) {
    await sendMessage(chatId,
      'ℹ️ Document besar diproses oleh dua formula V3 (OLD + HEVC Slow) sahaja. Tiga formula HQ Lab asal tidak boleh download Document besar menggunakan Telegram Bot API.'
    ).catch(() => {});
  }
  return true;
}
