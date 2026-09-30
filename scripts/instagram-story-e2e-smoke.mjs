import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { resolveMedia } from '../src/bot/media-resolver.js';
import { processStandardDownload } from '../src/features/downloader.js';

const execFileAsync = promisify(execFile);
const url = String(process.env.INSTAGRAM_STORY_SMOKE_URL || '').trim();
const chatId = Number(process.env.BOT_OWNER_ID || 0);

async function download(item, filePath) {
  const response = await fetch(item.url, {
    redirect: 'follow',
    headers: item.headers || {},
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.body) throw new Error(`story-download-http-${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
  return (await stat(filePath)).size;
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
    console.log('INSTAGRAM_STORY_E2E_SKIPPED no-story-url');
    return;
  }

  const startedAt = Date.now();
  const media = await resolveMedia('instagram', url);
  const video = media?.videos?.[0];
  if (!video?.url) throw new Error('story-resolver-no-video');

  const temp = await mkdtemp(path.join(tmpdir(), 'ig-story-e2e-'));
  try {
    const filePath = path.join(temp, 'story.mp4');
    const bytes = await download(video, filePath);
    const result = await probe(filePath);
    console.log('INSTAGRAM_STORY_MEDIA_PROBE_PASSED', JSON.stringify({
      bytes,
      hasVideo: result.hasVideo,
      hasAudio: result.hasAudio,
      video: result.video.slice(0, 240),
      audio: result.audio.slice(0, 240),
      source: video.source || null,
      resolveMs: Date.now() - startedAt,
    }));
    if (!result.hasVideo) throw new Error('story-output-has-no-video');

    if (Number.isFinite(chatId) && chatId > 0) {
      const sent = await processStandardDownload({
        chatId,
        url,
        platform: 'instagram',
        context: {
          baseUrl: String(process.env.PUBLIC_BASE_URL || '').trim(),
          mirrorGroupId: null,
          fence: null,
        },
        message: null,
      });
      if (!sent?.sentVideo) throw new Error('story-telegram-sendVideo-missing');
      console.log('INSTAGRAM_STORY_TELEGRAM_E2E_PASSED', JSON.stringify({
        messageId: sent.sentVideo?.message_id || null,
        fileId: sent.sentVideo?.video?.file_id || null,
        duration: sent.sentVideo?.video?.duration || null,
        width: sent.sentVideo?.video?.width || null,
        height: sent.sentVideo?.video?.height || null,
        totalMs: Date.now() - startedAt,
      }));
    }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error('INSTAGRAM_STORY_E2E_FAILED', error?.stack || error?.message || error);
  process.exit(1);
});
