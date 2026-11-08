import { createWriteStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
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
  return out;
}

function safeExtension(item) {
  const ext = String(item?.ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext || 'jpg';
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

async function downloadRemoteImage(item, filePath) {
  if (!item?.url) {
    const err = new Error('Status HQ image source is missing.');
    err.code = 'STATUS_IMAGE_SOURCE_MISSING';
    throw err;
  }

  const response = await fetchWithHeaderTimeout(
    item.url,
    {
      method: 'GET',
      headers: sourceHeaders(item.headers),
      redirect: 'follow',
    },
    process.env.STATUS_IMAGE_SOURCE_HEADER_TIMEOUT_MS || 30000,
  );

  if (!response.ok || !response.body) {
    const err = new Error(`Status HQ image source returned HTTP ${response.status}.`);
    err.code = 'STATUS_IMAGE_FETCH_ERROR';
    throw err;
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || !fileStat.size) {
    const err = new Error('Status HQ image source download is empty.');
    err.code = 'STATUS_IMAGE_SOURCE_EMPTY';
    throw err;
  }
}

async function cleanup(paths) {
  await Promise.all([...new Set(paths)].map((filePath) => rm(filePath, { force: true }).catch(() => {})));
}

// Telegram Photo is already compressed by Telegram before the bot receives it.
// Document uploads retain their original JPEG/PNG/WEBP/BMP/TIFF bytes. Detect
// the actual file signature (not just Telegram's sometimes generic extension)
// and never run these files through lossy JPEG encoding a second time.
async function originalImageExtension(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const signature = Buffer.alloc(16);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    if (bytesRead >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff) return 'jpg';
    if (bytesRead >= 8 && signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
    if (bytesRead >= 12 && signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    if (bytesRead >= 2 && signature.toString('ascii', 0, 2) === 'BM') return 'bmp';
    if (bytesRead >= 4 &&
        ((signature[0] === 0x49 && signature[1] === 0x49 && signature[2] === 0x2a && signature[3] === 0) ||
         (signature[0] === 0x4d && signature[1] === 0x4d && signature[2] === 0 && signature[3] === 0x2a))) return 'tiff';
    return '';
  } finally {
    await handle.close();
  }
}

export async function prepareWhatsAppStatusImageHQ({ image }) {
  const attemptId = randomUUID();
  const base = path.join(tmpdir(), `ar-status-image-${attemptId}`);
  const inputPath = `${base}-source.${safeExtension(image)}`;
  const allPaths = [inputPath];

  try {
    await downloadRemoteImage(image, inputPath);

    const originalExt = await originalImageExtension(inputPath);
    const outputExt = originalExt || 'jpg';
    const outputPath = `${base}-premium-plus-hq.${outputExt}`;
    allPaths.push(outputPath);
    if (originalExt) {
      // No re-encoding at all: pixel dimensions and source file bytes are preserved.
      await rename(inputPath, outputPath);
    } else {
      // Unknown supported image signatures: one conservative conversion only.
      await execFileAsync(
        ffmpegPath,
        [
          '-y',
          '-hide_banner',
          '-loglevel', 'error',
          '-nostats',
          '-nostdin',
          '-filter_threads', '1',
          '-i', inputPath,
          '-frames:v', '1',
          '-pix_fmt', 'yuvj444p',
          '-q:v', '2',
          '-threads', '1',
          '-map_metadata', '-1',
          outputPath,
        ],
        commandOptions(Number(process.env.STATUS_IMAGE_ENCODE_TIMEOUT_MS || 90000)),
      );
    }

    const outputStat = await stat(outputPath);
    if (!outputStat.isFile() || !outputStat.size) {
      const err = new Error('Premium+ HQ image encoding completed without output.');
      err.code = 'STATUS_IMAGE_OUTPUT_MISSING';
      throw err;
    }

    await rm(inputPath, { force: true }).catch(() => {});

    return {
      filePath: outputPath,
      size: outputStat.size,
      fileName: `status-hq.${outputExt}`,
      sourcePreserved: Boolean(originalExt),
      quality: originalExt
        ? 'Premium+ HQ image • original JPEG/PNG/WEBP/BMP/TIFF bytes and dimensions unchanged • Telegram document'
        : 'Premium+ HQ image • fallback JPEG with source dimensions preserved • Telegram document',
      cleanup: async () => cleanup(allPaths),
    };
  } catch (error) {
    await cleanup(allPaths);
    throw error;
  }
}
