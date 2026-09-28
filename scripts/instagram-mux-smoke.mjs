import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { chooseBestVideo, resolveMedia } from '../src/bot/media-resolver.js';
import { prepareInstagramVideoWithAudio } from '../src/instagram-video-audio-mux.js';

const execFileAsync = promisify(execFile);
const dedicatedUrl = String(process.env.INSTAGRAM_MUX_SMOKE_URL || '').trim();
const legacyEnabled = /^(?:1|true|yes|on)$/i.test(String(process.env.STATUS_HQ_SELFTEST_ENABLED || ''));
const legacyUrl = String(process.env.STATUS_HQ_SELFTEST_URL || '').trim();
const url = dedicatedUrl || (legacyEnabled && /instagram\.com\/(?:reel|reels|p)\//i.test(legacyUrl) ? legacyUrl : '');

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
  const video = stderr.match(/Video:[^\n]+/i)?.[0] || '';
  const audio = stderr.match(/Audio:[^\n]+/i)?.[0] || '';
  return { hasVideo: Boolean(video), hasAudio: Boolean(audio), video, audio };
}

async function main() {
  if (!url || !/instagram\.com\/(?:reel|reels|p)\//i.test(url)) {
    console.log('INSTAGRAM_MUX_SMOKE_SKIPPED');
    return;
  }

  const started = Date.now();
  const media = await resolveMedia('instagram', url);
  const video = chooseBestVideo(media?.videos || []);
  const audio = Array.isArray(media?.audios) ? media.audios.find((item) => item?.url) : null;
  if (!video?.url) throw new Error('Instagram mux smoke: video stream missing');
  if (!audio?.url) throw new Error('Instagram mux smoke: audio stream missing');

  let prepared = null;
  try {
    prepared = await prepareInstagramVideoWithAudio(video, audio, 50 * 1024 * 1024, {
      sourceUrl: media?.canonicalUrl || url,
    });
    const result = await probe(prepared.filePath);
    if (!result.hasVideo || !result.hasAudio) {
      throw new Error(`Instagram mux smoke output invalid: video=${result.hasVideo} audio=${result.hasAudio}`);
    }
    console.log('INSTAGRAM_MUX_SMOKE_PASSED', JSON.stringify({
      ok: true,
      ms: Date.now() - started,
      size: prepared.size,
      videoSource: video.source || null,
      videoQuality: video.quality || null,
      audioSource: audio.source || null,
      audioFormat: audio.formatId || null,
      outputVideo: result.video.slice(0, 260),
      outputAudio: result.audio.slice(0, 260),
    }));
  } finally {
    await prepared?.cleanup?.().catch(() => {});
  }
}

main().catch((error) => {
  console.error('INSTAGRAM_MUX_SMOKE_FAILED', error?.stack || error?.message || error);
  process.exit(1);
});
