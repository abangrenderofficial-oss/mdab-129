import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveInstagramWebAudio } from './instagram-web-audio.js';

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

function normalizeText(value = '') {
  let text = String(value || '');
  for (let index = 0; index < 3; index += 1) {
    const next = text
      .replaceAll('\\\\u0026', '&')
      .replaceAll('\\u0026', '&')
      .replaceAll('&amp;', '&')
      .replaceAll('\\/', '/')
      .replaceAll('\\"', '"');
    if (next === text) break;
    text = next;
  }
  return text;
}

function firstScalar(text, key) {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.match(new RegExp(`"${escaped}"\\s*:\\s*(?:"([^"]{0,240})"|(\\d+)|true|false|null)`, 'i'))?.[1]
    || text.match(new RegExp(`"${escaped}"\\s*:\\s*"?(\\d+)"?`, 'i'))?.[1]
    || null;
}

function audioReferenceSummary(rawText = '') {
  const text = normalizeText(rawText);
  return {
    hasClipsMetadata: /"clips_metadata"\s*:/i.test(text),
    hasMusicInfo: /"music_info"\s*:/i.test(text),
    hasOriginalSoundInfo: /"original_sound_info"\s*:/i.test(text),
    hasProgressiveUrlKey: /"(?:fast_start_)?progressive_download_url"\s*:/i.test(text),
    hasDashManifest: /"dash_manifest"\s*:/i.test(text),
    audioType: firstScalar(text, 'audio_type'),
    musicCanonicalId: firstScalar(text, 'music_canonical_id'),
    audioAssetId: firstScalar(text, 'audio_asset_id'),
    originalMediaId: firstScalar(text, 'original_media_id'),
    originalAudioSubtype: firstScalar(text, 'original_audio_subtype'),
    originalAudioTitle: firstScalar(text, 'original_audio_title'),
  };
}

function socialSoundFromText(rawText = '') {
  const text = normalizeText(rawText);
  const patterns = [
    ['fast_start_progressive_download_url', 120],
    ['progressive_download_url', 115],
    ['reactive_audio_download_url', 110],
    ['web_30s_preview_download_url', 70],
  ];
  const candidates = [];
  const seen = new Set();

  for (const [key, priority] of patterns) {
    const regex = new RegExp(`"${key}"\\s*:\\s*"(https?:\\/\\/[^"\\s]+)"`, 'gi');
    for (const match of text.matchAll(regex)) {
      const index = Number(match.index || 0);
      const nearby = text.slice(Math.max(0, index - 24000), Math.min(text.length, index + 24000));
      if (!/clips_metadata|music_info|music_asset|original_sound_info|original_sound|audio_asset|audio_cluster/i.test(nearby)) continue;
      try {
        const url = new URL(normalizeText(match[1])).toString();
        if (seen.has(url)) continue;
        seen.add(url);
        candidates.push({
          url,
          priority,
          key,
          startTimeMs: Number(nearby.match(/"audio_asset_start_time_in_ms"\s*:\s*(\d+)/i)?.[1] || 0),
          durationMs: Number(nearby.match(/"duration_in_ms"\s*:\s*(\d+)/i)?.[1] || 0) || null,
          audioAssetId: nearby.match(/"audio_asset_id"\s*:\s*"?(\d+)"?/i)?.[1] || null,
        });
      } catch {}
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0] || null;
}

async function listFilesRecursive(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  await walk(root);
  return out;
}

async function recoverFromYtDlpPages(binary, url, info) {
  const temp = await mkdtemp(path.join(tmpdir(), 'ig-pages-'));
  try {
    const args = [
      '--dump-single-json',
      '--skip-download',
      '--write-pages',
      '--no-warnings',
      '--no-playlist',
      '--no-check-certificates',
      '--js-runtimes', `node:${process.execPath}`,
      '--remote-components', 'ejs:github',
      '--',
      url,
    ];

    await execFileAsync(binary, args, {
      cwd: temp,
      timeout: Math.max(60000, Number(process.env.DOWNLOADER_TIMEOUT_MS || 45000) * 2),
      maxBuffer: 24 * 1024 * 1024,
      env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` },
    });

    const files = await listFilesRecursive(temp);
    let scannedBytes = 0;
    const references = [];
    for (const file of files) {
      const fileStat = await stat(file).catch(() => null);
      if (!fileStat?.isFile() || fileStat.size <= 0 || fileStat.size > 16 * 1024 * 1024) continue;
      if (scannedBytes + fileStat.size > 32 * 1024 * 1024) break;
      scannedBytes += fileStat.size;
      const text = await readFile(file, 'utf8').catch(() => '');
      const ref = audioReferenceSummary(text);
      if (Object.values(ref).some(Boolean)) {
        references.push({ file: path.basename(file), ...ref });
      }
      const sound = socialSoundFromText(text);
      if (!sound) continue;

      console.info('[instagram-audio] yt-dlp raw social sound found:', JSON.stringify({
        dumpFile: path.basename(file),
        key: sound.key,
        host: new URL(sound.url).hostname,
        audioAssetId: sound.audioAssetId,
        startTimeMs: sound.startTimeMs || 0,
        durationMs: sound.durationMs || null,
        scannedFiles: files.length,
      }));

      return {
        url: sound.url,
        ext: /\.m4a(?:\?|$)/i.test(sound.url) ? 'm4a' : 'mp4',
        quality: 'Instagram social sound',
        source: 'instagram-ytdlp-raw-social-sound',
        startTimeMs: sound.startTimeMs || 0,
        durationMs: sound.durationMs || null,
        headers: info?.http_headers || null,
      };
    }

    console.warn('[instagram-audio] yt-dlp raw page diagnosis:', JSON.stringify({
      dumpFiles: files.map((file) => path.basename(file)).slice(0, 20),
      dumpFileCount: files.length,
      scannedBytes,
      socialSoundFound: false,
      audioReferences: references,
    }));
    return null;
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
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

    try {
      const rawSound = await recoverFromYtDlpPages(binary, url, info);
      if (rawSound) return rawSound;
    } catch (dumpError) {
      console.warn('[instagram-audio] yt-dlp raw page recovery failed:', dumpError?.code, dumpError?.message);
    }

    try {
      return await resolveInstagramWebAudio(url);
    } catch (webError) {
      console.warn('[instagram-audio] sessioned web media-info failed:', webError?.code, webError?.message);
      const error = new Error(`yt-dlp exposed no audio; raw pages and web media info found no sound: ${webError?.message || webError}`);
      error.code = 'INSTAGRAM_YTDLP_AUDIO_NOT_FOUND';
      throw error;
    }
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
