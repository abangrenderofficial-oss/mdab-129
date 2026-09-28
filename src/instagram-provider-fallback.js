import chromiumPack from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const PROVIDER_RESPONSE_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_RESPONSE_TIMEOUT_MS || 10000);
const PROVIDER_PAGE_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_PAGE_TIMEOUT_MS || 10000);
const PROVIDER_INPUT_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_INPUT_TIMEOUT_MS || 6000);
const PROVIDER_MEDIA_TIMEOUT_MS = Number(process.env.INSTAGRAM_PROVIDER_MEDIA_TIMEOUT_MS || 7000);

function normalizeTarget(rawUrl) {
  const input = new URL(rawUrl);
  const match = input.pathname.match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/i);
  if (!match?.[1]) throw new Error('Instagram shortcode is missing.');
  return `https://www.instagram.com/reel/${match[1]}/`;
}

function deferredResponse(page, { match, pick, timeout = PROVIDER_RESPONSE_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('provider-timeout')), timeout);
    page.on('response', async (response) => {
      if (done || !match(response)) return;
      let json = null;
      try { json = await response.json(); } catch { return; }
      const verdict = pick(json);
      if (verdict?.ok) finish(resolve, verdict.value);
      else finish(reject, new Error(verdict?.error || 'provider-no-media'));
    });
  });
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

  const direct = [
    node.video,
    node.video_url,
    node.videoUrl,
    node.download_url,
    node.downloadUrl,
    node.src,
    node.url,
  ].find((value) => typeof value === 'string' && looksLikeVideoUrl(value));
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

async function runSss(page, target) {
  const outcome = deferredResponse(page, {
    match: (response) => /\/api\/convert/i.test(response.url()) && response.request().method() === 'POST',
    pick: pickSss,
  });
  await page.goto('https://sssinstagram.com/reels-downloader', {
    waitUntil: 'domcontentloaded',
    timeout: PROVIDER_PAGE_TIMEOUT_MS,
  });
  const input = page.locator('input[type="text"], input[name="url"], input#main_page_text').first();
  await input.waitFor({ timeout: PROVIDER_INPUT_TIMEOUT_MS });
  await input.fill(target);
  await page.locator('button[type="submit"], button:has-text("Download")').first().click();
  return outcome;
}

async function runFastVideoSave(page, target) {
  const outcome = deferredResponse(page, {
    match: (response) => /videodropper\.app\/allinone/i.test(response.url()),
    pick: pickFastVideoSave,
  });
  await page.goto('https://fastvideosave.net/', {
    waitUntil: 'domcontentloaded',
    timeout: PROVIDER_PAGE_TIMEOUT_MS,
  });
  await page.waitForTimeout(350);
  const input = page.locator('input[type="text"], input[type="url"], input[name*="url" i], input[placeholder*="link" i], input[placeholder*="url" i]').first();
  await input.waitFor({ timeout: PROVIDER_INPUT_TIMEOUT_MS });
  await input.fill(target);
  await page.locator('button:has-text("Download"), button[type="submit"], button:has-text("Search"), .btn').first().click();
  return outcome;
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

async function runProvider(browser, provider, target) {
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
  });
  try {
    const page = await context.newPage();
    const result = await provider.run(page, target);
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
    console.warn('[instagram-provider] provider failed:', provider.name, error?.message || error);
    throw new Error(`${provider.name}:${error?.message || error}`);
  } finally {
    await context.close().catch(() => {});
  }
}

export async function resolveInstagramProviderVideo(rawUrl) {
  const target = normalizeTarget(rawUrl);
  const browser = await launchBrowser();
  try {
    const providers = [
      { name: 'sssinstagram', run: runSss },
      { name: 'fastvideosave', run: runFastVideoSave },
    ];

    try {
      return await Promise.any(providers.map((provider) => runProvider(browser, provider, target)));
    } catch (error) {
      const reasons = Array.isArray(error?.errors)
        ? error.errors.map((item) => item?.message || String(item)).join('; ')
        : (error?.message || String(error));
      const out = new Error(`Instagram provider fallback failed (${reasons})`);
      out.code = 'INSTAGRAM_PROVIDER_FAILED';
      throw out;
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
