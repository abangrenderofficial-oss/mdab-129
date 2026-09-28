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
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`,
    },
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

function safeExtension(item, fallback) {
  const ext = String(item?.ext || fallback || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext || fallback || 'mp4';
}

async function fetchWithHeaderTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5000, Number(timeoutMs) || 30000));
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

async function downloadToFile(item, filePath, label) {
  const response = await fetchWithHeaderTimeout(
    item.url,
    {
      method: 'GET',
      headers: sourceHeaders(item.headers),
      redirect: 'follow',
    },
    process.env.INSTAGRAM_MUX_HEADER_TIMEOUT_MS || 30000,
  );

  if (!response.ok || !response.body) {
    const error = new Error(`${label} source returned HTTP ${response.status}.`);
    error.code = 'INSTAGRAM_MUX_FETCH_ERROR';
    throw error;
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || !fileStat.size) {
    const error = new Error(`${label} download is empty.`);
    error.code = 'INSTAGRAM_MUX_EMPTY_SOURCE';
    throw error;
  }
  return fileStat.size;
}

async function probeMedia(filePath) {
  let stderr = '';
  try {
    await execFileAsync(
      ffmpegPath,
      ['-hide_banner', '-i', filePath],
      commandOptions(Number(process.env.INSTAGRAM_MUX_PROBE_TIMEOUT_MS || 8000)),
    );
  } catch (error) {
    stderr = String(error?.stderr || error?.message || '');
  }
  const videoLine = stderr.match(/Video:[^\n]+/i)?.[0] || '';
  const audioLine = stderr.match(/Audio:[^\n]+/i)?.[0] || '';
  return {
    hasAudio: Boolean(audioLine),
    videoLine,
    audioLine,
    h264: /Video:\s*h264\b/i.test(videoLine) || /\bavc1\b/i.test(videoLine),
  };
}

export async function prepareInstagramVideoWithAudio(video, audio, maxBytes, options = {}) {
  if (!video?.url) throw new Error('Instagram video URL is missing.');
  if (!audio?.url) throw new Error('Instagram audio URL is missing.');

  const attemptId = randomUUID();
  const base = path.join(tmpdir(), `ar-ig-mux-${attemptId}`);
  const videoPath = `${base}-video.${safeExtension(video, 'mp4')}`;
  const audioPath = `${base}-audio.${safeExtension(audio, 'm4a')}`;
  const outputPath = `${base}-merged.mp4`;
  const cleanupPaths = [videoPath, audioPath, outputPath];

  const cleanup = async () => {
    await Promise.all(cleanupPaths.map((filePath) => rm(filePath, { force: true }).catch(() => {})));
  };

  try {
    const [videoBytes, audioBytes] = await Promise.all([
      downloadToFile(video, videoPath, 'Instagram video'),
      downloadToFile(audio, audioPath, 'Instagram audio'),
    ]);

    const inputProbe = await probeMedia(videoPath);
    const startSeconds = Math.max(0, Number(audio.startTimeMs || 0) / 1000);
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-nostats',
      '-nostdin',
      '-i', videoPath,
    ];

    if (startSeconds > 0) args.push('-ss', startSeconds.toFixed(3));
    args.push('-i', audioPath, '-map', '0:v:0', '-map', '1:a:0');

    if (inputProbe.h264) {
      args.push('-c:v', 'copy');
    } else {
      args.push(
        '-c:v', 'libx264',
        '-preset', String(process.env.INSTAGRAM_MUX_H264_PRESET || 'veryfast'),
        '-crf', String(process.env.INSTAGRAM_MUX_H264_CRF || '19'),
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'high',
        '-level', '4.1',
        '-threads', String(Math.max(1, Math.min(2, Number(process.env.INSTAGRAM_MUX_THREADS || 2) || 2))),
      );
    }

    args.push(
      '-c:a', 'aac',
      '-profile:a', 'aac_low',
      '-b:a', String(process.env.INSTAGRAM_MUX_AUDIO_BITRATE || '160k'),
      '-ar', '48000',
      '-ac', '2',
      '-shortest',
      '-movflags', '+faststart',
      '-map_metadata', '-1',
      outputPath,
    );

    await execFileAsync(
      ffmpegPath,
      args,
      commandOptions(Number(process.env.INSTAGRAM_MUX_TIMEOUT_MS || 70000)),
    );

    const outputStat = await stat(outputPath);
    if (!outputStat.isFile() || !outputStat.size) {
      const error = new Error('Instagram audio mux produced no output file.');
      error.code = 'INSTAGRAM_MUX_OUTPUT_MISSING';
      throw error;
    }

    const outputProbe = await probeMedia(outputPath);
    if (!outputProbe.hasAudio) {
      const error = new Error('Instagram mux output still has no audio stream.');
      error.code = 'INSTAGRAM_MUX_AUDIO_VERIFY_FAILED';
      throw error;
    }
    if (!outputProbe.h264) {
      const error = new Error('Instagram mux output is not H.264/iPhone compatible.');
      error.code = 'INSTAGRAM_MUX_VIDEO_COMPAT_VERIFY_FAILED';
      throw error;
    }

    const limit = Number(maxBytes || 0);
    if (Number.isFinite(limit) && limit > 0 && outputStat.size > limit) {
      const error = new Error(`Instagram merged video exceeds Telegram upload limit (${outputStat.size} > ${limit}).`);
      error.code = 'INSTAGRAM_MUX_TOO_LARGE';
      throw error;
    }

    console.info('[instagram-mux] merged separate social sound:', JSON.stringify({
      videoBytes,
      audioBytes,
      outputBytes: outputStat.size,
      audioSource: audio.source || null,
      audioStartTimeMs: Number(audio.startTimeMs || 0) || 0,
      videoQuality: video.quality || null,
      inputVideo: inputProbe.videoLine || null,
      outputVideo: outputProbe.videoLine || null,
      outputAudio: outputProbe.audioLine || null,
      transcodedVideoToH264: !inputProbe.h264,
      sourceUrl: options.sourceUrl || video.sourceUrl || null,
    }));

    return {
      filePath: outputPath,
      size: outputStat.size,
      mergedAudio: true,
      h264Compatible: true,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
