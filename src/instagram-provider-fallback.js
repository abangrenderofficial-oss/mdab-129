import chromiumPack from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const PROVIDER_RESPONSE_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_RESPONSE_TIMEOUT_MS || 7000);
const PROVIDER_PAGE_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_PAGE_TIMEOUT_MS || 8000);
const PROVIDER_INPUT_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_INPUT_TIMEOUT_MS || 4500);
const PROVIDER_MEDIA_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_MEDIA_TIMEOUT_MS || 5500);
const PROVIDER_ATTEMPT_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_ATTEMPT_TIMEOUT_MS || 9000);
const PROVIDER_TOTAL_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_TOTAL_TIMEOUT_MS || 18000);
const PROVIDER_BROWSER_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_BROWSER_TIMEOUT_MS || 9000);
const PROVIDER_CACHE_TTL_MS = Number(process.env.INSTAGRAM_PROVIDER_CACHE_TTL_MS || 5 * 60 * 1000);

const providerCache = new Map();

function normalizeTarget(rawUrl) {
  const input = new URL(rawUrl);
  const match = input.pathname.match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/i);
  if (!match?.[1]) throw new Error('Instagram shortcode is missing.');
  return `https://www.instagram.com/reel/${match[1]}/`;
}

function looksLikeVideoUrl(value = '') {
  const url = String(value || '');
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.(?:jpe?g|png|webp|gif)(?:\?|$)/i.test(url)) return false;
  return /\.mp4(?:\?|$)/i.test(url)
    || /(?:video|media|download|cdn)/i.test(url)
    || /mime(?:type)?=video/i.test(url);
}

function numericQuality(value) {
  const match = String(value ?? '').match(/(\d{3,4})/);
  return match ? Number(match[1]) : 0;
}

function collectVideoCandidates(node, out = [], depth = 0) {
  if (depth > 7 || node == null) return out;
  if (typeof node === 'string') {
    if (looksLikeVideoUrl(node)) out.push({ url: node, quality: 'provider', width: null, height: null });
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectVideoCandidates(child, out, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;

  const mediaHint = String(
    node?.type ?? node?.ext ?? node?.mime_type ?? node?.mimeType ?? node?.mime ?? node?.kind ?? '',
  ).toLowerCase();
  const hintedVideo = /(?:video|mp4|quicktime)/i.test(mediaHint);
  const direct = [
    node.video,
    node.video_url,
    node.videoUrl,
    node.download_url,
    node.downloadUrl,
    node.src,
    node.url,
  ].find((value) => typeof value === 'string' && (looksLikeVideoUrl(value) || (hintedVideo && /^https?:\/\//i.test(value))));
  if (direct) {
    out.push({
      url: direct,
      quality: node?.quality ?? node?.subname ?? node?.name ?? node?.label ?? 'provider',
      width: node?.width ?? null,
      height: node?.height ?? null,
    });
  }

  for (const value of Object.values(node)) collectVideoCandidates(value, out, depth + 1);
  return out;
}

function bestUniqueVideo(json) {
  const seen = new Set();
  const candidates = [];
  for (const item of collectVideoCandidates(json)) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    candidates.push(item);
  }
  candidates.sort((a, b) => {
    const aScore = Math.max(Number(a.width || 0), Number(a.height || 0), numericQuality(a.quality));
    const bScore = Math.max(Number(b.width || 0), Number(b.height || 0), numericQuality(b.quality));
    return bScore - aScore;
  });
  return candidates[0] || null;
}

function extractError(json) {
  if (typeof json?.error === 'string' && json.error.trim()) return json.error.trim();
  if (typeof json?.message === 'string' && json.message.trim()) return json.message.replace(/\s+/g, ' ').trim().slice(0, 180);
  if (typeof json?.response_type === 'string' && json.response_type.trim()) return json.response_type.trim();
  return null;
}

function pickSss(json) {
  const nodes = Array.isArray(json) ? json : [json];
  const explicit = [];
  for (const node of nodes) {
    const raw = Array.isArray(node?.url)
      ? node.url
      : Array.isArray(node?.medias)
        ? node.medias
        : [];
    for (const item of raw) collectVideoCandidates(item, explicit, 0);
  }
  const video = bestUniqueVideo(explicit.length ? explicit : json);
  if (video) return { ok: true, value: video };
  return { ok: false, error: extractError(json) || 'sss-no-video' };
}

function pickFastVideoSave(json) {
  const explicit = [];
  const arrays = [json?.video, json?.medias, json?.url];
  for (const raw of arrays) {
    if (!Array.isArray(raw)) continue;
    for (const item of raw) collectVideoCandidates(item, explicit, 0);
  }
  const video = bestUniqueVideo(explicit.length ? explicit : json);
  if (video) return { ok: true, value: video };
  return { ok: false, error: extractError(json) || 'fastvideosave-no-video' };
}

function withTimeout(promise, timeoutMs, label) {
  const timeout = Math.max(1000, Number(timeoutMs) || 1000);
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), timeout);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function triggerAndReadJson(page, matcher, trigger, picker) {
  const responsePromise = page.waitForResponse(matcher, { timeout: PROVIDER_RESPONSE_TIMEOUT_MS });
  const [response] = await Promise.all([
    responsePromise,
    trigger(),
  ]);
  const text = await withTimeout(
    response.text(),
    Math.min(PROVIDER_RESPONSE_TIMEOUT_MS, 5000),
    'provider-response-body-timeout',
  );
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('provider-invalid-json');
  }
  const verdict = picker(json);
  if (!verdict?.ok) throw new Error(verdict?.error || 'provider-no-media');
  return verdict.value;
}

async function runSss(page, target) {
  await page.goto('https://sssinstagram.com/reels-downloader', {
    waitUntil: 'domcontentloaded',
    timeout: PROVIDER_PAGE_TIMEOUT_MS,
  });
  const input = page.locator('input[type="text"], input[name="url"], input#main_page_text').first();
  await input.waitFor({ timeout: PROVIDER_INPUT_TIMEOUT_MS });
  await input.fill(target);
  const button = page.locator('button[type="submit"], button:has-text("Download")').first();
  return triggerAndReadJson(
    page,
    (response) => /\/api\/convert/i.test(response.url()) && response.request().method() === 'POST',
    () => button.click({ timeout: PROVIDER_INPUT_TIMEOUT_MS }),
    pickSss,
  );
}

async function runFastVideoSave(page, target) {
  await page.goto('https://fastvideosave.net/', {
    waitUntil: 'domcontentloaded',
    timeout: PROVIDER_PAGE_TIMEOUT_MS,
  });
  await page.waitForTimeout(350);
  const input = page.locator('input[type="text"], input[type="url"], input[name*="url" i], input[placeholder*="link" i], input[placeholder*="url" i]').first();
  await input.waitFor({ timeout: PROVIDER_INPUT_TIMEOUT_MS });
  await input.fill(target);
  const button = page.locator('button:has-text("Download"), button[type="submit"], button:has-text("Search"), .btn').first();
  return triggerAndReadJson(
    page,
    (response) => /videodropper\.app\/allinone/i.test(response.url()),
    () => button.click({ timeout: PROVIDER_INPUT_TIMEOUT_MS }),
    pickFastVideoSave,
  );
}

async function launchBrowser() {
  const executablePath = await chromiumPack.executablePath();
  return playwrightChromium.launch({
    args: chromiumPack.args,
    executablePath,
    headless: true,
    timeout: PROVIDER_BROWSER_TIMEOUT_MS,
  });
}

function providerHeaders(name) {
  return {
    'User-Agent': UA,
    Referer: name === 'sssinstagram' ? 'https://sssinstagram.com/' : 'https://fastvideosave.net/',
    Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
  };
}

async function validateProviderVideo(url, name) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { ...providerHeaders(name), Range: 'bytes=0-1023' },
    signal: AbortSignal.timeout(PROVIDER_MEDIA_TIMEOUT_MS),
  });
  const ok = response.ok || response.status === 206;
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  await response.body?.cancel().catch(() => {});
  if (!ok) throw new Error(`provider-media-http-${response.status}`);
  if (type && !type.includes('video') && !type.includes('octet-stream')) {
    throw new Error(`provider-media-type-${type}`);
  }
  return true;
}

async function runProviderInContext(browser, provider, target, attemptTimeoutMs) {
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
  });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PROVIDER_INPUT_TIMEOUT_MS);
    const result = await withTimeout(
      provider.run(page, target),
      attemptTimeoutMs,
      'provider-attempt-timeout',
    );
    if (!result?.url) throw new Error('provider-no-url');
    await validateProviderVideo(result.url, provider.name);
    console.info('[instagram-provider] merged Reel candidate resolved:', JSON.stringify({
      provider: provider.name,
      host: new URL(result.url).hostname,
      quality: result.quality ?? null,
      mediaValidated: true,
    }));
    return {
      url: result.url,
      sourceUrl: target,
      quality: `Instagram ${provider.name}`,
      width: result.width ?? null,
      height: result.height ?? null,
      ext: 'mp4',
      hasAudio: true,
      source: `instagram-${provider.name}`,
      headers: providerHeaders(provider.name),
      filesize: null,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function cachedProviderVideo(target) {
  const cached = providerCache.get(target);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    providerCache.delete(target);
    return null;
  }
  console.info('[instagram-provider] using cached merged Reel candidate');
  return { ...cached.value };
}

function cacheProviderVideo(target, value) {
  providerCache.set(target, {
    value: { ...value },
    expiresAt: Date.now() + Math.max(30_000, PROVIDER_CACHE_TTL_MS),
  });
  if (providerCache.size > 100) {
    const first = providerCache.keys().next().value;
    if (first) providerCache.delete(first);
  }
}

function isDefinitiveFailure(message = '') {
  return /private|removed|doesn't exist|not found|invalid url/i.test(String(message));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveInstagramProviderVideo(rawUrl) {
  const target = normalizeTarget(rawUrl);
  const cached = cachedProviderVideo(target);
  if (cached) return cached;

  const providers = [
    { name: 'sssinstagram', run: runSss, attempts: 2 },
    { name: 'fastvideosave', run: runFastVideoSave, attempts: 1 },
  ];
  const failures = [];
  const startedAt = Date.now();
  let browser = null;

  try {
    browser = await launchBrowser();

    for (const provider of providers) {
      for (let attempt = 1; attempt <= provider.attempts; attempt += 1) {
        const elapsed = Date.now() - startedAt;
        const remaining = PROVIDER_TOTAL_TIMEOUT_MS - elapsed;
        if (remaining <= 1000) break;

        if (!browser?.isConnected()) {
          await browser?.close().catch(() => {});
          browser = await launchBrowser();
        }

        try {
          const result = await runProviderInContext(
            browser,
            provider,
            target,
            Math.min(PROVIDER_ATTEMPT_TIMEOUT_MS, remaining),
          );
          cacheProviderVideo(target, result);
          return result;
        } catch (error) {
          const message = error?.message || String(error);
          failures.push(`${provider.name}#${attempt}:${message}`);
          console.warn('[instagram-provider] provider failed:', provider.name, `attempt=${attempt}`, message);
          if (isDefinitiveFailure(message)) break;
          if (attempt < provider.attempts) await sleep(650);
        }
      }
    }
  } finally {
    await browser?.close().catch(() => {});
  }

  const out = new Error(`Instagram provider fallback failed (${failures.join('; ')})`);
  out.code = 'INSTAGRAM_PROVIDER_FAILED';
  throw out;
}
