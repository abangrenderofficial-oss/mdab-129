import chromiumPack from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);
const url = String(process.env.INSTAGRAM_STORY_SMOKE_URL || '').trim();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function looksVideo(value = '') {
  const v = String(value || '');
  return /^https?:\/\//i.test(v) && !/\.(?:jpe?g|png|webp|gif)(?:\?|$)/i.test(v)
    && (/\.mp4(?:\?|$)/i.test(v) || /cdninstagram|video|media|download/i.test(v));
}

function collect(node, out = [], depth = 0) {
  if (node == null || depth > 8) return out;
  if (typeof node === 'string') {
    if (looksVideo(node)) out.push(node.replace(/\\u0026/g, '&').replace(/\\\//g, '/'));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collect(item, out, depth + 1));
    return out;
  }
  if (typeof node !== 'object') return out;
  for (const value of Object.values(node)) collect(value, out, depth + 1);
  return out;
}

async function probeUrl(mediaUrl) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ig-story-sss-'));
  const filePath = path.join(dir, 'story.mp4');
  try {
    const response = await fetch(mediaUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Referer: 'https://sssinstagram.com/' },
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok || !response.body) throw new Error(`media-http-${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
    let stderr = '';
    try {
      await execFileAsync(ffmpegPath, ['-hide_banner', '-i', filePath], { timeout: 12000, maxBuffer: 8 * 1024 * 1024 });
    } catch (error) {
      stderr = String(error?.stderr || error?.message || '');
    }
    const video = stderr.match(/Video:[^\n]+/i)?.[0] || '';
    const audio = stderr.match(/Audio:[^\n]+/i)?.[0] || '';
    return { hasVideo: Boolean(video), hasAudio: Boolean(audio), video, audio };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  if (!/instagram\.com\/stories\/[^/]+\/\d+/i.test(url)) {
    console.log('INSTAGRAM_STORY_SSS_PROBE_SKIPPED');
    return;
  }
  const started = Date.now();
  const executablePath = await chromiumPack.executablePath();
  const browser = await playwrightChromium.launch({ args: chromiumPack.args, executablePath, headless: true, timeout: 12000 });
  try {
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await context.newPage();
    await page.goto('https://sssinstagram.com/en1/story-saver', { waitUntil: 'domcontentloaded', timeout: 12000 });
    const input = page.locator('input[type="text"], input[name="url"], input#main_page_text').first();
    await input.waitFor({ timeout: 6000 });
    await input.fill(url);
    const responsePromise = page.waitForResponse((response) => /\/api\/convert/i.test(response.url()) && response.request().method() === 'POST', { timeout: 12000 });
    const button = page.locator('button[type="submit"], button:has-text("Download")').first();
    const [response] = await Promise.all([responsePromise, button.click({ timeout: 6000 })]);
    const text = await response.text();
    console.log('INSTAGRAM_STORY_SSS_RESPONSE', JSON.stringify({ status: response.status(), ms: Date.now() - started, bytes: text.length, prefix: text.slice(0, 160).replace(/https?:\/\/[^"' ]+/g, '<url>') }));
    const data = JSON.parse(text);
    const candidates = [...new Set(collect(data))];
    if (!candidates.length) throw new Error('sss-story-no-video');
    console.log('INSTAGRAM_STORY_SSS_CANDIDATES', JSON.stringify(candidates.slice(0, 10).map((value) => ({ host: new URL(value).hostname }))));
    let passed = null;
    for (const candidate of candidates.slice(0, 4)) {
      try {
        const result = await probeUrl(candidate);
        console.log('INSTAGRAM_STORY_SSS_MEDIA_PROBE', JSON.stringify({ host: new URL(candidate).hostname, hasVideo: result.hasVideo, hasAudio: result.hasAudio, video: result.video.slice(0, 220), audio: result.audio.slice(0, 220) }));
        if (result.hasVideo) { passed = result; break; }
      } catch (error) {
        console.warn('INSTAGRAM_STORY_SSS_MEDIA_ERROR', error?.message || error);
      }
    }
    if (!passed?.hasVideo) throw new Error('sss-story-no-playable-video');
    console.log('INSTAGRAM_STORY_SSS_PROBE_PASSED', JSON.stringify({ ok: true, ms: Date.now() - started, hasAudio: passed.hasAudio }));
    await context.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error('INSTAGRAM_STORY_SSS_PROBE_FAILED', error?.stack || error?.message || error);
  process.exit(1);
});
