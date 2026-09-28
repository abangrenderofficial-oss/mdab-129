import { execFile } from 'node:child_process';
import { chmod } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { resolveMedia, chooseBestVideo } from '../src/bot/media-resolver.js';
import { localMediaLane } from '../src/bot/job-lanes.js';
import { heavyWorkerConfigured } from '../src/heavy-worker-dispatch.js';
import { prepareWhatsAppStatusHQ } from '../src/status-hq.js';
import { detectPlatform } from '../src/platform.js';

const execFileAsync = promisify(execFile);
const CASES = [
  ['tiktok', 'https://vt.tiktok.com/ZSqqYxc13/'],
  ['instagram', 'https://www.instagram.com/reel/DdVLsscjj2o/?stkn=MXV3a2hncmE3cWZheQ=='],
  ['threads', 'https://www.threads.com/share/BALVYg5Lmq/'],
  ['youtube', 'https://youtu.be/RKdxQwnRRqw?si=GJX9HDe4OBsxwBYQ'],
];
const STATUS_URL = 'https://www.tiktok.com/@j_k_123_7/video/7654589734496341262';
const SELFTEST_ENABLED = /^(?:1|true|yes|on)$/i.test(String(process.env.STATUS_HQ_SELFTEST_ENABLED || ''));
const SELFTEST_URL = String(process.env.STATUS_HQ_SELFTEST_URL || '').trim();

async function probeOutputAudio(filePath) {
  let stderr = '';
  try {
    await execFileAsync(ffmpegPath, ['-hide_banner', '-i', filePath], {
      timeout: 12000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    stderr = String(error?.stderr || error?.message || '');
  }

  const audioLine = stderr.match(/Audio:[^\n]+/i)?.[0] || '';
  return {
    hasAudio: Boolean(audioLine),
    audioLine: audioLine.slice(0, 300),
  };
}

async function diagnoseYtDlpFormats(platform, url) {
  if (platform !== 'instagram') return;
  try {
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
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` },
    });

    const info = JSON.parse(stdout);
    const formats = Array.isArray(info?.formats) ? info.formats : [];
    const summary = formats.map((f) => ({
      id: f?.format_id ?? null,
      ext: f?.ext ?? null,
      protocol: f?.protocol ?? null,
      width: f?.width ?? null,
      height: f?.height ?? null,
      vcodec: f?.vcodec ?? null,
      acodec: f?.acodec ?? null,
      abr: f?.abr ?? null,
      tbr: f?.tbr ?? null,
      filesize: f?.filesize ?? f?.filesize_approx ?? null,
      audioChannels: f?.audio_channels ?? null,
      formatNote: f?.format_note ?? null,
    }));

    console.log('STATUS_HQ_SELFTEST_YTDLP_INFO', JSON.stringify({
      extractor: info?.extractor_key || info?.extractor || null,
      id: info?.id || null,
      ext: info?.ext || null,
      vcodec: info?.vcodec || null,
      acodec: info?.acodec || null,
      requestedFormats: Array.isArray(info?.requested_formats)
        ? info.requested_formats.map((f) => ({ id: f?.format_id ?? null, vcodec: f?.vcodec ?? null, acodec: f?.acodec ?? null }))
        : null,
      formatCount: summary.length,
      formats: summary,
    }));
  } catch (error) {
    console.error('STATUS_HQ_SELFTEST_YTDLP_DIAG_FAILED', JSON.stringify({
      code: error?.code ?? null,
      message: String(error?.message || error).slice(0, 1400),
      stderr: String(error?.stderr || '').slice(-2400),
    }));
  }
}

async function verifyResolver(platform, url) {
  const started = Date.now();
  const media = await resolveMedia(platform, url);
  const best = chooseBestVideo(media?.videos || []);
  const count = (media?.videos?.length || 0) + (media?.images?.length || 0) + (media?.audios?.length || 0);
  if (!count) throw new Error(`${platform}: resolver returned no media`);
  console.log('ISOLATION_SMOKE_RESOLVER', JSON.stringify({
    platform,
    ok: true,
    ms: Date.now() - started,
    videos: media?.videos?.length || 0,
    images: media?.images?.length || 0,
    audios: media?.audios?.length || 0,
    bestSource: best?.source || null,
  }));
}

async function prepareStatusSource(platform, url) {
  if (platform === 'instagram' || platform === 'youtube') {
    return prepareWhatsAppStatusHQ({
      sourceUrl: url,
      platform,
      video: null,
      audio: null,
    });
  }

  const media = await resolveMedia(platform, url);
  const best = chooseBestVideo(media?.videos || []);
  if (!best) throw new Error(`Status HQ smoke could not resolve a ${platform} source video`);
  const audio = Array.isArray(media?.audios)
    ? media.audios.find((item) => item?.url) || null
    : null;

  return prepareWhatsAppStatusHQ({
    sourceUrl: media?.canonicalUrl || url,
    platform,
    video: best,
    audio,
  });
}

async function verifyStatusHq({ url = STATUS_URL, platform = 'tiktok', requireAudio = false, label = 'ISOLATION_SMOKE_STATUS_HQ' } = {}) {
  const started = Date.now();
  let prepared = null;
  try {
    prepared = await localMediaLane(() => prepareStatusSource(platform, url));
    if (!prepared?.filePath || !prepared?.size) throw new Error('Status HQ smoke produced no output');

    const outputAudio = await probeOutputAudio(prepared.filePath);
    const sourceHasAudio = Boolean(prepared.source?.hasAudio);
    const profileHasAudio = Boolean(prepared.profile?.hasAudio);

    if (requireAudio && !sourceHasAudio) {
      await diagnoseYtDlpFormats(platform, url);
      throw new Error(`${platform} self-test source did not contain an audio track after source recovery`);
    }
    if (requireAudio && (!profileHasAudio || !outputAudio.hasAudio)) {
      await diagnoseYtDlpFormats(platform, url);
      throw new Error(`${platform} Premium+ HQ output lost audio`);
    }

    console.log(label, JSON.stringify({
      ok: true,
      platform,
      ms: Date.now() - started,
      size: prepared.size,
      sourceHasAudio,
      profileHasAudio,
      outputHasAudio: outputAudio.hasAudio,
      outputAudio: outputAudio.audioLine,
      tier: prepared.profile?.tier || null,
      videoKbps: prepared.profile?.videoKbps || null,
      audioKbps: prepared.profile?.audioKbps || null,
      attempt: prepared.attempt || null,
    }));
  } finally {
    await prepared?.cleanup?.().catch(() => {});
  }
}

async function softCheck(name, task) {
  try {
    await task();
    return { name, ok: true };
  } catch (error) {
    console.warn('ISOLATION_SMOKE_SOFT_FAIL', JSON.stringify({
      name,
      ok: false,
      error: String(error?.message || error || 'unknown_error').slice(0, 1200),
    }));
    return { name, ok: false };
  }
}

async function main() {
  console.log('ISOLATION_SMOKE_START');

  if (!heavyWorkerConfigured()) throw new Error('GitHub heavy worker token is not configured');
  console.log('ISOLATION_SMOKE_HEAVY_WORKER', JSON.stringify({ ok: true }));

  if (SELFTEST_ENABLED) {
    if (!SELFTEST_URL) throw new Error('STATUS_HQ_SELFTEST_ENABLED is on but STATUS_HQ_SELFTEST_URL is empty');
    const platform = detectPlatform(SELFTEST_URL);
    if (!platform) throw new Error('STATUS_HQ_SELFTEST_URL platform is unsupported');
    await verifyStatusHq({
      url: SELFTEST_URL,
      platform,
      requireAudio: true,
      label: 'STATUS_HQ_SELFTEST_PASSED',
    });
  }

  const results = [];
  for (const [platform, url] of CASES) {
    results.push(await softCheck(`resolver:${platform}`, () => verifyResolver(platform, url)));
  }
  results.push(await softCheck('status_hq:e2e', () => verifyStatusHq()));

  const softFailures = results.filter((item) => !item.ok).map((item) => item.name);
  console.log('ISOLATION_SMOKE_PASSED', JSON.stringify({
    hardChecks: 'passed',
    targetedSelfTest: SELFTEST_ENABLED,
    softChecks: results.length,
    softFailures,
  }));
}

main().catch((error) => {
  console.error('ISOLATION_SMOKE_FAILED', error?.stack || error?.message || error);
  process.exit(1);
});
