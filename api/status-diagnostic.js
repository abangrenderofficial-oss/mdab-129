import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { localMediaLane } from '../src/bot/job-lanes.js';
import { prepareWhatsAppStatusHQ } from '../src/status-hq.js';

const execFileAsync = promisify(execFile);
const TEST_URL = 'https://www.instagram.com/reel/Dd00o7WRnRH/?stkn=aTgyanVqcXI0bXR4';

async function probeMedia(filePath) {
  let stderr = '';
  try {
    await execFileAsync(ffmpegPath, ['-hide_banner', '-i', filePath], {
      timeout: 12000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    stderr = String(error?.stderr || error?.message || '');
  }

  const match = stderr.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/i);
  const audioLine = stderr.match(/Audio:[^\n]+/i)?.[0] || '';
  return {
    width: match ? Number(match[1]) : null,
    height: match ? Number(match[2]) : null,
    hasAudio: Boolean(audioLine),
    audioLine: audioLine.slice(0, 300),
  };
}

export default async function handler(req, res) {
  const started = Date.now();
  let prepared = null;

  try {
    const result = await localMediaLane(async () => {
      prepared = await prepareWhatsAppStatusHQ({
        sourceUrl: TEST_URL,
        platform: 'instagram',
        video: null,
        audio: null,
      });
      const output = await probeMedia(prepared.filePath);
      return { prepared, output };
    });

    const output = result.output;
    const sourceRatio = prepared.source?.width && prepared.source?.height
      ? prepared.source.width / prepared.source.height
      : null;
    const outputRatio = output.width && output.height ? output.width / output.height : null;
    const ratioDiff = sourceRatio && outputRatio ? Math.abs(outputRatio - sourceRatio) / sourceRatio : null;
    const ratioOk = ratioDiff === null || ratioDiff <= 0.02;
    const sourceHasAudio = Boolean(prepared.source?.hasAudio);
    const outputHasAudio = Boolean(output.hasAudio);

    return res.status(200).json({
      ok: Boolean(prepared.filePath && prepared.size && ratioOk && sourceHasAudio && outputHasAudio),
      stage: 'complete',
      architecture: 'instagram-premium-hq-audio-e2e-v1',
      testUrl: TEST_URL,
      ms: Date.now() - started,
      singleFile: true,
      sourceHasAudio,
      outputHasAudio,
      outputAudio: output.audioLine,
      sourceDuration: prepared.source?.duration || null,
      sourceWidth: prepared.source?.width || null,
      sourceHeight: prepared.source?.height || null,
      outputWidth: output.width,
      outputHeight: output.height,
      ratioDiff,
      size: prepared.size,
      quality: prepared.quality,
      profile: prepared.profile?.mode || null,
      tier: prepared.profile?.tier || null,
      videoKbps: prepared.profile?.videoKbps || null,
      audioKbps: prepared.profile?.audioKbps || null,
      profileHasAudio: prepared.profile?.hasAudio ?? null,
      attempt: prepared.attempt || null,
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      stage: 'error',
      architecture: 'instagram-premium-hq-audio-e2e-v1',
      testUrl: TEST_URL,
      ms: Date.now() - started,
      code: error?.code || 'ERROR',
      error: String(error?.message || error).slice(0, 1800),
    });
  } finally {
    await prepared?.cleanup?.().catch(() => {});
  }
}
