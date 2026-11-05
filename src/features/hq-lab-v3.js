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

export async function processOwnerHqLabV3(message) {
  if (!ownerOnly(message)) return false;
  const chatId = message.chat.id;
  const key = String(chatId);
  const raw = String(message?.text || '').trim().toLowerCase();
  const cmd = command(message);
  const active = Number(sessions().get(key) || 0) > Date.now();

  if (cmd === '/hqlab' && /^\/hqlab(?:@\w+)?\s+v3$/.test(raw)) {
    sessions().set(key, Date.now() + LAB_TTL_MS);
    await sendMessage(chatId, [
      '🧪 Premium + HQ V3 | HQ Lab Owner Test',
      'Hantar video 2K / 4K sebagai File / Document (MP4, MOV, MKV dan lain-lain).',
      'Output: sehingga 1080p • 60 FPS • bitrate maksimum 10 Mbps • saiz maksimum 10 MB.',
      'Untuk durasi panjang, bitrate akan diturunkan mengikut bajet saiz fail.',
      'Output MP4 akan dihantar sebagai Document untuk kekalkan bitstream asal.',
      'Had input ujian: 500 MiB. Taip /hqlab off untuk batal.',
      'Premium+ HQ production dan tiga formula /hqlab asal tidak diubah.',
    ].join('\n')).catch(() => {});
    return true;
  }

  if (cmd === '/hqlab') {
    if (active && /^\/hqlab(?:@\w+)?\s+(?:off|stop|cancel|batal|v3\s+off)$/.test(raw)) {
      sessions().delete(key);
      await sendMessage(chatId, '🧪 HQ Lab V3 ditutup.').catch(() => {});
      return true;
    }
    // Keep the original /hqlab command and three benchmarks completely unchanged.
    sessions().delete(key);
    return false;
  }

  if (!active) {
    sessions().delete(key);
    return false;
  }
  if (cmd.startsWith('/')) return false;

  const document = message?.document;
  if (!videoDocument(document)) {
    await sendMessage(chatId, '🧪 HQ Lab V3 menunggu video sebagai File / Document, bukan Telegram video biasa.').catch(() => {});
    return true;
  }
  if (Number(document.file_size || 0) > MAX_DOCUMENT_BYTES) {
    await sendMessage(chatId, '❌ Video Document melebihi had ujian V3 500 MiB.').catch(() => {});
    return true;
  }

  try {
    await dispatch({ chatId, userId: message.from.id, document });
    sessions().delete(key);
    await sendMessage(chatId,
      '🧪 HQ Lab V3 diterima. Worker V3 sedang jalankan encoding. Hasil MP4 Document dihantar jika berjaya. Formula production tidak disentuh.'
    ).catch(() => {});
  } catch (error) {
    console.error('[hqlab/v3] dispatch failed:', error?.message);
    await sendMessage(chatId, '❌ ' + (error?.message || 'HQ Lab V3 gagal dimulakan.')).catch(() => {});
  }
  return true;
}
