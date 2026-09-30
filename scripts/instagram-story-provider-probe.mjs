import { createCipheriv } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);
const url = String(process.env.INSTAGRAM_STORY_SMOKE_URL || '').trim();
const KEY = Buffer.from('qwertyuioplkjhgf', 'utf8');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MAX_BYTES = 40 * 1024 * 1024;

function encrypt(value) {
  const cipher = createCipheriv('aes-128-ecb', KEY, null);
  cipher.setAutoPadding(true);
  return cipher.update(value, 'utf8', 'hex') + cipher.final('hex');
}

function looksUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function classify(obj, key, value) {
  const hint = String(obj?.type ?? obj?.ext ?? obj?.mime_type ?? obj?.mimeType ?? obj?.kind ?? key ?? '').toLowerCase();
  const lower = String(value).toLowerCase();
  if (/audio|mp3|m4a|aac|ogg/.test(hint) || /\.(?:mp3|m4a|aac|ogg)(?:\?|$)/i.test(lower)) return 'audio';
  if (/video|mp4|quicktime/.test(hint) || /\.mp4(?:\?|$)/i.test(lower) || /cdninstagram|video/.test(lower)) return 'video';
  return 'unknown';
}

function collect(node, out = [], depth = 0, parentKey = '') {
  if (node == null || depth > 8) return out;
  if (Array.isArray(node)) {
    node.forEach((item) => collect(item, out, depth + 1, parentKey));
    return out;
  }
  if (typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if (looksUrl(value)) {
      out.push({
        key,
        kind: classify(node, key, value),
        url: value,
        type: node?.type ?? null,
        ext: node?.ext ?? null,
        quality: node?.quality ?? node?.label ?? node?.name ?? null,
        width: node?.width ?? null,
        height: node?.height ?? null,
      });
    }
    collect(value, out, depth + 1, key);
  }
  return out;
}

async function download(candidate, filePath) {
  const response = await fetch(candidate.url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Referer: 'https://fastvideosave.net/' },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error(`too-large-${declared}`);
  let total = 0;
  const limiter = new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > MAX_BYTES) throw new Error('too-large-stream');
      controller.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body.pipeThrough(limiter)), createWriteStream(filePath));
  return total;
}

async function probe(filePath) {
  let stderr = '';
  try {
    await execFileAsync(ffmpegPath, ['-hide_banner', '-i', filePath], { timeout: 12000, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    stderr = String(error?.stderr || error?.message || '');
  }
  const video = stderr.match(/Video:[^\n]+/i)?.[0] || '';
  const audio = stderr.match(/Audio:[^\n]+/i)?.[0] || '';
  return { hasVideo: Boolean(video), hasAudio: Boolean(audio), video, audio };
}

async function main() {
  if (!/instagram\.com\/stories\/[^/]+\/\d+/i.test(url)) {
    console.log('INSTAGRAM_STORY_PROVIDER_PROBE_SKIPPED');
    return;
  }

  const started = Date.now();
  const response = await fetch('https://api.videodropper.app/allinone', {
    method: 'GET',
    redirect: 'follow',
    headers: {
      Accept: '*/*',
      Origin: 'https://fastvideosave.net',
      Referer: 'https://fastvideosave.net/',
      'User-Agent': UA,
      url: encrypt(url),
    },
    signal: AbortSignal.timeout(12000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`provider-http-${response.status}:${text.slice(0, 120)}`);
  const data = JSON.parse(text);
  const candidates = collect(data);
  const unique = [];
  const seen = new Set();
  for (const item of candidates) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    unique.push(item);
  }

  console.log('INSTAGRAM_STORY_PROVIDER_SHAPE', JSON.stringify({
    ms: Date.now() - started,
    rootType: Array.isArray(data) ? 'array' : typeof data,
    rootKeys: data && !Array.isArray(data) && typeof data === 'object' ? Object.keys(data).slice(0, 30) : [],
    candidates: unique.map((item) => ({
      key: item.key,
      kind: item.kind,
      type: item.type,
      ext: item.ext,
      quality: item.quality,
      width: item.width,
      height: item.height,
      host: (() => { try { return new URL(item.url).hostname; } catch { return null; } })(),
    })).slice(0, 20),
  }));

  const temp = await mkdtemp(path.join(tmpdir(), 'ig-story-probe-'));
  try {
    const probeTargets = unique.filter((item) => item.kind === 'video').slice(0, 4);
    if (!probeTargets.length) throw new Error('provider-returned-no-video-candidate');
    for (let i = 0; i < probeTargets.length; i += 1) {
      const filePath = path.join(temp, `candidate-${i}.bin`);
      try {
        const bytes = await download(probeTargets[i], filePath);
        const result = await probe(filePath);
        console.log('INSTAGRAM_STORY_PROVIDER_MEDIA_PROBE', JSON.stringify({
          index: i,
          bytes,
          hasVideo: result.hasVideo,
          hasAudio: result.hasAudio,
          video: result.video.slice(0, 220),
          audio: result.audio.slice(0, 220),
        }));
      } catch (error) {
        console.warn('INSTAGRAM_STORY_PROVIDER_MEDIA_PROBE_ERROR', JSON.stringify({ index: i, error: error?.message || String(error) }));
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error('INSTAGRAM_STORY_PROVIDER_PROBE_FAILED', error?.stack || error?.message || error);
  process.exit(1);
});
