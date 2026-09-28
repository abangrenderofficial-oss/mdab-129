import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { resolveInstagramProviderVideo } from '../src/instagram-provider-fallback.js';

const execFileAsync = promisify(execFile);
const url = String(process.env.INSTAGRAM_MUX_SMOKE_URL || '').trim();

async function probe(filePath) {
  let stderr = '';
  try {
    await execFileAsync(ffmpegPath, ['-hide_banner', '-i', filePath], {
      timeout: 12000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    stderr = String(error?.stderr || error?.message || '');
  }
  return {
    hasVideo: /\bVideo:\s/i.test(stderr),
    hasAudio: /\bAudio:\s/i.test(stderr),
    video: stderr.match(/Video:[^\n]+/i)?.[0] || '',
    audio: stderr.match(/Audio:[^\n]+/i)?.[0] || '',
  };
}

async function main() {
  if (!url || !/instagram\.com\/(?:reel|reels|p)\//i.test(url)) {
    console.log('INSTAGRAM_PROVIDER_AV_SMOKE_SKIPPED');
    return;
  }

  const started = Date.now();
  const candidate = await resolveInstagramProviderVideo(url);
  if (!candidate?.url) throw new Error('Provider returned no video URL');

  const temp = await mkdtemp(path.join(tmpdir(), 'ig-provider-av-'));
  const filePath = path.join(temp, 'provider.mp4');
  try {
    const response = await fetch(candidate.url, {
      redirect: 'follow',
      headers: candidate.headers || {},
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok || !response.body) throw new Error(`Provider media HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
    const fileStat = await stat(filePath);
    if (!fileStat.size) throw new Error('Provider media file is empty');

    const result = await probe(filePath);
    console.log('INSTAGRAM_PROVIDER_AV_SMOKE_RESULT', JSON.stringify({
      ok: result.hasVideo && result.hasAudio,
      ms: Date.now() - started,
      source: candidate.source || null,
      host: new URL(candidate.url).hostname,
      bytes: fileStat.size,
      hasVideo: result.hasVideo,
      hasAudio: result.hasAudio,
      video: result.video.slice(0, 260),
      audio: result.audio.slice(0, 260),
    }));
    if (!result.hasVideo || !result.hasAudio) {
      throw new Error(`Provider AV smoke invalid: video=${result.hasVideo} audio=${result.hasAudio}`);
    }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error('INSTAGRAM_PROVIDER_AV_SMOKE_FAILED', error?.stack || error?.message || error);
  process.exit(1);
});
