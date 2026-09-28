import { execFile } from 'node:child_process';
import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function hasAudio(format = {}) {
  return Boolean(format?.acodec && format.acodec !== 'none');
}

function hasVideo(format = {}) {
  return Boolean(format?.vcodec && format.vcodec !== 'none');
}

function score(format = {}) {
  const audioOnly = Number(hasAudio(format) && !hasVideo(format));
  const abr = Number(format.abr || 0);
  const asr = Number(format.asr || 0) / 1000;
  const tbr = Number(format.tbr || 0) / 100;
  return audioOnly * 100000 + abr * 100 + asr + tbr;
}

function safeFormatSummary(formats = []) {
  return formats.map((format) => ({
    id: format?.format_id ?? null,
    ext: format?.ext ?? null,
    protocol: format?.protocol ?? null,
    vcodec: format?.vcodec ?? null,
    acodec: format?.acodec ?? null,
    abr: format?.abr ?? null,
    asr: format?.asr ?? null,
    tbr: format?.tbr ?? null,
    width: format?.width ?? null,
    height: format?.height ?? null,
    audioChannels: format?.audio_channels ?? null,
    note: format?.format_note ?? null,
  }));
}

export async function resolveInstagramYtDlpAudio(url) {
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
    url,
  ], {
    timeout: Number(process.env.DOWNLOADER_TIMEOUT_MS || 45000),
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` },
  });

  const info = JSON.parse(stdout);
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const candidates = formats
    .filter((format) => format?.url && hasAudio(format))
    .sort((a, b) => score(b) - score(a));

  const best = candidates[0];
  if (!best) {
    console.warn('[instagram-audio] yt-dlp format diagnosis:', JSON.stringify({
      extractor: info?.extractor_key || info?.extractor || null,
      id: info?.id || null,
      topLevelVcodec: info?.vcodec || null,
      topLevelAcodec: info?.acodec || null,
      formatCount: formats.length,
      formats: safeFormatSummary(formats),
    }));
    const error = new Error('yt-dlp did not expose an Instagram audio stream.');
    error.code = 'INSTAGRAM_YTDLP_AUDIO_NOT_FOUND';
    throw error;
  }

  console.info('[instagram-audio] yt-dlp sound stream found:', JSON.stringify({
    formatId: best.format_id || null,
    ext: best.ext || null,
    audioOnly: !hasVideo(best),
    acodec: best.acodec || null,
    abr: best.abr || null,
    asr: best.asr || null,
  }));

  return {
    url: best.url,
    ext: best.ext || 'm4a',
    quality: best.format_note || (best.abr ? `${Math.round(best.abr)} kbps` : 'Instagram sound'),
    source: 'instagram-ytdlp-audio',
    startTimeMs: 0,
    durationMs: Number(info?.duration || 0) ? Number(info.duration) * 1000 : null,
    headers: best.http_headers || info?.http_headers || null,
    formatId: best.format_id || null,
  };
}
