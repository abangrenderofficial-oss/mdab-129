import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { chooseBestVideo, resolveMedia } from '../src/bot/media-resolver.js';
import { resolveInstagramProviderVideo } from '../src/instagram-provider-fallback.js';
import { prepareInstagramVideoWithAudio } from '../src/instagram-video-audio-mux.js';

const execFileAsync = promisify(execFile);
const dedicatedUrl = String(process.env.INSTAGRAM_MUX_SMOKE_URL || '').trim();
const legacyEnabled = /^(?:1|true|yes|on)$/i.test(String(process.env.STATUS_HQ_SELFTEST_ENABLED || ''));
const legacyUrl = String(process.env.STATUS_HQ_SELFTEST_URL || '').trim();
const url = dedicatedUrl || (legacyEnabled && /instagram\.com\/(?:reel|reels|p)\//i.test(legacyUrl) ? legacyUrl : '');
const MAX_PROBE_BYTES = 55 * 1024 * 1024;

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

function cleanHeaders(value = {}) {
  const out = {};
  for (const [key, raw] of Object.entries(value || {})) {
    if (raw === null || raw === undefined) continue;
    out[String(key)] = String(raw);
  }
  return out;
}

async function downloadForProbe(candidate, info, filePath) {
  const headers = cleanHeaders(candidate?.headers || candidate?.http_headers || info?.http_headers || {});
  if (!headers.Referer && !headers.referer) headers.Referer = 'https://www.instagram.com/';
  const response = await fetch(candidate.url, { redirect: 'follow', headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_PROBE_BYTES) throw new Error(`candidate too large: ${declared}`);

  let total = 0;
  const limiter = new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > MAX_PROBE_BYTES) throw new Error(`candidate exceeded ${MAX_PROBE_BYTES}`);
      controller.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body.pipeThrough(limiter)), createWriteStream(filePath));
  return total;
}

async function probeResolvedVideo(candidate) {
  const temp = await mkdtemp(path.join(tmpdir(), 'ig-resolved-probe-'));
  const filePath = path.join(temp, 'resolved.mp4');
  try {
    const bytes = await downloadForProbe(candidate, {}, filePath);
    const result = await probe(filePath);
    console.log('INSTAGRAM_RESOLVED_VIDEO_PROBE_RESULT', JSON.stringify({
      source: candidate?.source || null,
      claimedHasAudio: candidate?.hasAudio ?? null,
      bytes,
      hasVideo: result.hasVideo,
      hasAudio: result.hasAudio,
      video: result.video.slice(0, 220),
      audio: result.audio.slice(0, 220),
    }));
    return { result, bytes };
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

async function probeProgressiveCandidates(targetUrl) {
  const binary = path.join(process.cwd(), 'bin', 'yt-dlp');
  await chmod(binary, 0o755).catch(() => {});
  const { stdout } = await execFileAsync(binary, [
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
    '--no-playlist',
    '--no-check-certificates',
    '--js-runtimes', `node:${process.execPath}`,
    '--remote-components', 'ejs:github',
    '--',
    targetUrl,
  ], {
    timeout: 60000,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` },
  });

  const info = JSON.parse(stdout);
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const candidates = formats
    .filter((item) => item?.url && String(item?.ext || '').toLowerCase() === 'mp4')
    .filter((item) => !String(item?.format_id || '').toLowerCase().startsWith('dash-'))
    .sort((a, b) => {
      const aDirect = /^\d+$/.test(String(a?.format_id || '')) ? 1 : 0;
      const bDirect = /^\d+$/.test(String(b?.format_id || '')) ? 1 : 0;
      return (bDirect - aDirect) || (Number(b?.height || 0) - Number(a?.height || 0)) || (Number(b?.width || 0) - Number(a?.width || 0));
    })
    .slice(0, 5);

  console.log('INSTAGRAM_PROGRESSIVE_PROBE_CANDIDATES', JSON.stringify(candidates.map((item) => ({
    id: item?.format_id || null,
    ext: item?.ext || null,
    width: item?.width || null,
    height: item?.height || null,
    vcodec: item?.vcodec || null,
    acodec: item?.acodec || null,
    protocol: item?.protocol || null,
  }))));

  if (!candidates.length) return null;
  const temp = await mkdtemp(path.join(tmpdir(), 'ig-progressive-probe-'));
  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const filePath = path.join(temp, `candidate-${index}.mp4`);
      try {
        const bytes = await downloadForProbe(candidate, info, filePath);
        const fileStat = await stat(filePath);
        const result = await probe(filePath);
        console.log('INSTAGRAM_PROGRESSIVE_PROBE_RESULT', JSON.stringify({
          id: candidate?.format_id || null,
          bytes: fileStat.size || bytes,
          hasVideo: result.hasVideo,
          hasAudio: result.hasAudio,
          video: result.video.slice(0, 220),
          audio: result.audio.slice(0, 220),
        }));
        if (result.hasVideo && result.hasAudio) return { candidate, result, bytes: fileStat.size || bytes };
      } catch (error) {
        console.warn('INSTAGRAM_PROGRESSIVE_PROBE_ERROR', JSON.stringify({ id: candidate?.format_id || null, error: error?.message || String(error) }));
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return null;
}

async function runMuxProbe(video, audio, targetUrl, mode, started) {
  let prepared = null;
  try {
    prepared = await prepareInstagramVideoWithAudio(video, audio, 50 * 1024 * 1024, { sourceUrl: targetUrl });
    const result = await probe(prepared.filePath);
    if (!result.hasVideo || !result.hasAudio) throw new Error(`Instagram mux smoke output invalid: video=${result.hasVideo} audio=${result.hasAudio}`);
    console.log('INSTAGRAM_MUX_SMOKE_PASSED', JSON.stringify({
      ok: true,
      mode,
      ms: Date.now() - started,
      size: prepared.size,
      videoSource: video.source || null,
      videoQuality: video.quality || null,
      audioSource: audio.source || null,
      audioFormat: audio.formatId || null,
      outputVideo: result.video.slice(0, 260),
      outputAudio: result.audio.slice(0, 260),
    }));
    return true;
  } finally {
    await prepared?.cleanup?.().catch(() => {});
  }
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
  const targetUrl = media?.canonicalUrl || url;

  // If the resolver already returns an AV file today, still force the exact
  // target architecture: preserve this video track, obtain a Reel AV donor,
  // take ONLY donor audio, and mux the two. This makes the silent-video + added
  // Reel sound path testable even when Instagram/provider behavior changes.
  if (!audio?.url) {
    const resolved = await probeResolvedVideo(video).catch((error) => {
      console.warn('INSTAGRAM_RESOLVED_VIDEO_PROBE_ERROR', error?.message || error);
      return null;
    });
    if (resolved?.result?.hasVideo && resolved?.result?.hasAudio) {
      const donor = await resolveInstagramProviderVideo(targetUrl);
      await runMuxProbe(video, {
        ...donor,
        quality: 'Reel added sound',
        source: `${donor.source || 'instagram-provider'}-audio-donor`,
      }, targetUrl, 'forced-audio-donor-mux', started);
      return;
    }

    console.warn('INSTAGRAM_MUX_SMOKE_NO_SEPARATE_AUDIO; probing progressive MP4 candidates');
    const progressive = await probeProgressiveCandidates(targetUrl);
    if (!progressive) throw new Error('Instagram mux smoke: no separate audio; resolved provider and progressive MP4 files are physically silent/unavailable');
    console.log('INSTAGRAM_MUX_SMOKE_PASSED', JSON.stringify({
      ok: true,
      mode: 'progressive-av',
      ms: Date.now() - started,
      formatId: progressive.candidate?.format_id || null,
      bytes: progressive.bytes,
      outputVideo: progressive.result.video.slice(0, 260),
      outputAudio: progressive.result.audio.slice(0, 260),
    }));
    return;
  }

  await runMuxProbe(video, audio, targetUrl, 'separate-audio-mux', started);
}

main().catch((error) => {
  console.error('INSTAGRAM_MUX_SMOKE_FAILED', error?.stack || error?.message || error);
  process.exit(1);
});
