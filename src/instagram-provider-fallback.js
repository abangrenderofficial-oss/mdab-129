import chromiumPack from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const PROVIDER_RESPONSE_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_RESPONSE_TIMEOUT_MS || 10000);
const PROVIDER_PAGE_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_PAGE_TIMEOUT_MS || 10000);
const PROVIDER_INPUT_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_INPUT_TIMEOUT_MS || 6000);
const PROVIDER_MEDIA_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_MEDIA_TIMEOUT_MS || 7000);
const PROVIDER_ATTEMPT_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_ATTEMPT_TIMEOUT_MS || 15000);

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
    || /(?:video|media|download)/i.test(url)
    || /mime(?:type)?=video/i.test(url);
}

function collectVideoCandidates(node, out = [], depth = 0) {
  if (depth > 6 || node == null) return out;
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
    node?.type ?? node?.ext ?? node?.mime_type ?? node?.mimeType ?? node?.mime ?? '',
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

function firstUniqueVideo(json) {
  const seen = new Set();
  for (const item of collectVideoCandidates(json)) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    return item;
  }
  return null;
}

function pickSss(json) {
  const video = firstUniqueVideo(json);
  if (video) return { ok: true, value: video };
  return { ok: false, error: json?.message || json?.error || 'sss-no-video' };
}

function pickFastVideoSave(json) {
  const video = firstUniqueVideo(json);
  if (video) return { ok: true, value: video };
  return { ok: false, error: json?.message || json?.error || 'fastvideosave-no-video' };
}

async function triggerAndReadJson(page, matcher, trigger, picker) {
  const responsePromise = page.waitForResponse(matcher, { timeout: PROVIDER_RESPONSE_TIMEOUT_MS });
  const [response] = await Promise.all([
    responsePromise,
    trigger(),
  ]);
  const json = await response.json();
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

async function runProviderInContext(browser, provider, target) {
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    context.close().catch(() => {});
  }, PROVIDER_ATTEMPT_TIMEOUT_MS);

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PROVIDER_INPUT_TIMEOUT_MS);
    const result = await provider.run(page, target);
    if (timedOut) throw new Error('provider-attempt-timeout');
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
  } catch (error) {
    const message = timedOut ? 'provider-attempt-timeout' : (error?.message || String(error));
    console.warn('[instagram-provider] provider failed:', provider.name, message);
    throw new Error(`${provider.name}:${message}`);
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => {});
  }
}

export async function resolveInstagramProviderVideo(rawUrl) {
  const target = normalizeTarget(rawUrl);
  const providers = [
    { name: 'sssinstagram', run: runSss },
    { name: 'fastvideosave', run: runFastVideoSave },
  ];
  const browser = await launchBrowser();
  const failures = [];

  try {
    for (const provider of providers) {
      try {
        return await runProviderInContext(browser, provider, target);
      } catch (error) {
        failures.push(error?.message || String(error));
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const out = new Error(`Instagram provider fallback failed (${failures.join('; ')})`);
  out.code = 'INSTAGRAM_PROVIDER_FAILED';
  throw out;
}
