import { createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

function commandOptions(timeoutMs) {
  return {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` },
  };
}

function sourceHeaders(headers) {
  const source = headers && typeof headers === 'object' ? headers : {};
  const allowed = new Set(['user-agent', 'referer', 'origin', 'accept', 'accept-language']);
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (!allowed.has(String(key).toLowerCase())) continue;
    if (typeof value !== 'string' || !value) continue;
    out[key] = value;
  }
  if (!Object.keys(out).some((key) => key.toLowerCase() === 'user-agent')) {
    out['User-Agent'] = 'Mozilla/5.0 (compatible; ARDownloader/1.0)';
  }
  return out;
}

async function download(video, filePath) {
  if (!video?.url) throw new Error('Instagram Story source URL is missing.');
  const response = await fetch(video.url, {
    redirect: 'follow',
    headers: sourceHeaders(video.headers),
    signal: AbortSignal.timeout(Number(process.env.INSTAGRAM_STORY_HQ_FETCH_TIMEOUT_MS || 30000)),
  });
  if (!response.ok || !response.body) {
    const error = new Error(`Instagram Story HQ source returned HTTP ${response.status}.`);
    error.code = 'INSTAGRAM_STORY_HQ_FETCH_FAILED';
    throw error;
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
  const info = await stat(filePath);
  if (!info.isFile() || !info.size) throw new Error('Instagram Story HQ source is empty.');
  return info.size;
}

function parseDuration(value) {
  const match = String(value || '').match(/(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function probe(filePath) {
  let stderr = '';
  try {
    await execFileAsync(ffmpegPath, ['-hide_banner', '-i', filePath], commandOptions(12000));
  } catch (error) {
    stderr = String(error?.stderr || error?.message || '');
  }
  const videoLine = stderr.match(/Video:[^\n]+/i)?.[0] || '';
  const audioLine = stderr.match(/Audio:[^\n]+/i)?.[0] || '';
  const dimensions = videoLine.match(/\b(\d{2,5})x(\d{2,5})\b/i);
  const duration = parseDuration(stderr.match(/Duration:\s*([^,]+)/i)?.[1] || '');
  if (!videoLine || !duration) {
    const error = new Error('Instagram Story HQ could not probe source video.');
    error.code = 'INSTAGRAM_STORY_HQ_PROBE_FAILED';
    throw error;
  }
  return {
    duration,
    width: dimensions ? Number(dimensions[1]) : null,
    height: dimensions ? Number(dimensions[2]) : null,
    hasAudio: Boolean(audioLine),
    videoLine,
    audioLine,
  };
}

function storyFilter() {
  const sar = 'if(gt(sar,0),sar,1)';
  const fit = `min(1,min(1080/(iw*${sar}),1920/ih))`;
  return [
    `scale=w='max(2,trunc((iw*${sar})*${fit}/2)*2)':h='max(2,trunc(ih*${fit}/2)*2)':flags=lanczos`,
    'setsar=1',
  ].join(',');
}

export async function prepareInstagramStoryStatusHQ({ video, sourceUrl = '' }) {
  const id = randomUUID();
  const base = path.join(tmpdir(), `ar-story-hq-${id}`);
  const inputPath = `${base}-source.mp4`;
  const outputPath = `${base}-premium-hq.mp4`;
  const paths = [inputPath, outputPath];
  const cleanup = async () => Promise.all(paths.map((p) => rm(p, { force: true }).catch(() => {})));

  try {
    const sourceBytes = await download(video, inputPath);
    const source = await probe(inputPath);
    const maxRate = Math.max(1800, Math.min(3800, Number(process.env.INSTAGRAM_STORY_HQ_MAXRATE_KBPS || 3200)));
    const audioKbps = source.hasAudio ? 128 : 0;
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-nostdin',
      '-i', inputPath,
      '-map', '0:v:0', ...(source.hasAudio ? ['-map', '0:a:0?'] : []),
      '-vf', storyFilter(),
      '-c:v', 'libx264',
      '-preset', String(process.env.INSTAGRAM_STORY_HQ_PRESET || 'veryfast'),
      '-crf', String(process.env.INSTAGRAM_STORY_HQ_CRF || '17'),
      '-maxrate', `${maxRate}k`,
      '-bufsize', `${maxRate * 2}k`,
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-level', '4.1',
      '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      ...(source.hasAudio
        ? ['-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2', '-b:a', `${audioKbps}k`]
        : ['-an']),
      '-movflags', '+faststart',
      '-map_metadata', '-1',
      '-metadata:s:v:0', 'rotate=0',
      '-threads', String(Math.max(1, Math.min(2, Number(process.env.INSTAGRAM_STORY_HQ_THREADS || 2) || 2))),
      outputPath,
    ];

    await execFileAsync(
      ffmpegPath,
      args,
      commandOptions(Number(process.env.INSTAGRAM_STORY_HQ_ENCODE_TIMEOUT_MS || 180000)),
    );

    const outputInfo = await stat(outputPath);
    const result = await probe(outputPath);
    if (source.hasAudio && !result.hasAudio) {
      const error = new Error('Instagram Story Premium+ HQ lost the audio track.');
      error.code = 'INSTAGRAM_STORY_HQ_AUDIO_MISSING';
      throw error;
    }

    console.info('[status-hq/instagram-story] Story-specific encode complete:', JSON.stringify({
      sourceUrl,
      sourceBytes,
      outputBytes: outputInfo.size,
      sourceWidth: source.width,
      sourceHeight: source.height,
      sourceHasAudio: source.hasAudio,
      outputHasAudio: result.hasAudio,
      maxRateKbps: maxRate,
      codec: 'h264-high-yuv420p',
    }));

    return {
      filePath: outputPath,
      size: outputInfo.size,
      source,
      profile: {
        mode: 'instagram-story-premium-hq',
        tier: Math.max(source.width || 0, source.height || 0) >= 1920 ? 1080 : 720,
        maxWidth: 1080,
        maxHeight: 1920,
        videoKbps: maxRate,
        audioKbps,
        hasAudio: result.hasAudio,
        colorMode: 'sdr',
        codec: 'h264-high',
      },
      quality: 'Instagram Story Premium+ HQ • original-source • H.264 High 8-bit/AAC • WhatsApp-safe',
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
