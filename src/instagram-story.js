import chromiumPack from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const PAGE_TIMEOUT_MS = Number(process.env.INSTAGRAM_STORY_PAGE_TIMEOUT_MS || 12000);
const RESULT_TIMEOUT_MS = Number(process.env.INSTAGRAM_STORY_RESULT_TIMEOUT_MS || 14000);
const MEDIA_TIMEOUT_MS = Number(process.env.INSTAGRAM_STORY_MEDIA_TIMEOUT_MS || 8000);
const CACHE_TTL_MS = Number(process.env.INSTAGRAM_STORY_CACHE_TTL_MS || 5 * 60 * 1000);

const cache = new Map();

export function isInstagramStoryUrl(rawUrl = '') {
  try {
    return /^\/stories\/[^/?#]+\/\d+\/?$/i.test(new URL(rawUrl).pathname);
  } catch {
    return false;
  }
}

export function canonicalInstagramStoryUrl(rawUrl) {
  const input = new URL(rawUrl);
  const match = input.pathname.match(/^\/stories\/([^/?#]+)\/(\d+)/i);
  if (!match?.[1] || !match?.[2]) {
    const error = new Error('Instagram Story URL is invalid.');
    error.code = 'INSTAGRAM_STORY_URL_INVALID';
    throw error;
  }
  return `https://www.instagram.com/stories/${match[1]}/${match[2]}/`;
}

function headers() {
  return {
    'User-Agent': UA,
    Referer: 'https://sssinstagram.com/story-saver',
    Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
  };
}

function looksVideoUrl(value = '') {
  const text = String(value || '');
  if (!/^https?:\/\//i.test(text)) return false;
  if (/\.(?:jpe?g|png|webp|gif)(?:\?|$)/i.test(text)) return false;
  return /media\.sssinstagram\.com\/get/i.test(text)
    || /\.mp4(?:\?|$)/i.test(text)
    || /(?:video|download|cdn)/i.test(text);
}

function collectUrls(node, out = [], depth = 0) {
  if (node == null || depth > 9) return out;
  if (typeof node === 'string') {
    if (looksVideoUrl(node)) out.push(node.replaceAll('\\u0026', '&').replaceAll('\\/', '/'));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectUrls(child, out, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;
  for (const value of Object.values(node)) collectUrls(value, out, depth + 1);
  return out;
}

async function validateVideo(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { ...headers(), Range: 'bytes=0-2047' },
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  const ok = response.ok || response.status === 206;
  await response.body?.cancel().catch(() => {});
  if (!ok) throw new Error(`story-media-http-${response.status}`);
  if (type && !type.includes('video') && !type.includes('octet-stream')) {
    throw new Error(`story-media-type-${type}`);
  }
  return true;
}

function cached(target) {
  const item = cache.get(target);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    cache.delete(target);
    return null;
  }
  return { ...item.value };
}

function putCache(target, value) {
  cache.set(target, { value: { ...value }, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
}

async function closeBounded(promise) {
  if (!promise) return;
  await Promise.race([
    Promise.resolve(promise).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1200)),
  ]).catch(() => {});
}

export async function resolveInstagramStory(rawUrl) {
  const target = canonicalInstagramStoryUrl(rawUrl);
  const hit = cached(target);
  if (hit) {
    console.info('[instagram-story] using cached Story media');
    return hit;
  }

  const startedAt = Date.now();
  const executablePath = await chromiumPack.executablePath();
  const browser = await playwrightChromium.launch({
    args: chromiumPack.args,
    executablePath,
    headless: true,
    timeout: PAGE_TIMEOUT_MS,
  });

  let context = null;
  try {
    context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    await page.goto('https://sssinstagram.com/story-saver', { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });

    const input = page.locator('input#input, input[type="text"], input[placeholder*="Paste" i]').first();
    await input.waitFor({ timeout: 7000 });
    await input.fill(target);
    const button = page.locator('.form__submit, button:has-text("DOWNLOAD"), button[type="submit"]').first();

    const apiPromise = page.waitForResponse(
      (response) => /api-wh\.sssinstagram\.com\/api\/v1\/instagram\/story/i.test(response.url())
        && response.request().method() === 'POST',
      { timeout: RESULT_TIMEOUT_MS },
    );
    const mediaPromise = page.waitForResponse(
      (response) => /media\.sssinstagram\.com\/get/i.test(response.url())
        && /^video\//i.test(String(response.headers()['content-type'] || '')),
      { timeout: RESULT_TIMEOUT_MS },
    ).catch(() => null);

    await button.click({ timeout: 7000 });
    const apiResponse = await apiPromise;
    let apiJson = null;
    try { apiJson = await apiResponse.json(); } catch {}

    let mediaResponse = await Promise.race([
      mediaPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 4500)),
    ]);

    let videoUrl = mediaResponse?.url?.() || '';
    if (!videoUrl && apiJson) {
      const unique = [...new Set(collectUrls(apiJson))];
      for (const candidate of unique) {
        try {
          await validateVideo(candidate);
          videoUrl = candidate;
          break;
        } catch {}
      }
    }

    if (!videoUrl) {
      const error = new Error('Instagram Story provider returned no downloadable video.');
      error.code = 'INSTAGRAM_STORY_NO_VIDEO';
      throw error;
    }

    await validateVideo(videoUrl);
    const result = {
      platform: 'Instagram',
      title: 'Instagram Story',
      thumbnail: '',
      duration: null,
      canonicalUrl: target,
      images: [],
      videos: [{
        url: videoUrl,
        sourceUrl: target,
        quality: 'Instagram Story',
        width: null,
        height: null,
        ext: 'mp4',
        // SSSInstagram returns the final Story playback asset. If Instagram attached
        // music to the Story, this asset contains that playback audio; otherwise it
        // is simply the original Story video.
        hasAudio: true,
        source: 'instagram-story-sss',
        headers: headers(),
        filesize: null,
      }],
      audios: [],
    };

    console.info('[instagram-story] Story video resolved:', JSON.stringify({
      host: new URL(videoUrl).hostname,
      ms: Date.now() - startedAt,
    }));
    putCache(target, result);
    return result;
  } finally {
    await closeBounded(context?.close());
    await closeBounded(browser?.close());
  }
}
