import chromiumPack from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function normalizeTarget(rawUrl) {
  const input = new URL(rawUrl);
  const match = input.pathname.match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/i);
  if (!match?.[1]) throw new Error('Instagram shortcode is missing.');
  return `https://www.instagram.com/reel/${match[1]}/`;
}

function deferredResponse(page, { match, pick, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(
      () => finish(reject, new Error('provider-timeout')),
      timeout,
    );
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

function pickSss(json) {
  const nodes = Array.isArray(json) ? json : [json];
  const videos = [];
  for (const node of nodes) {
    const raw = Array.isArray(node?.url)
      ? node.url
      : Array.isArray(node?.medias)
        ? node.medias
        : [];
    for (const item of raw) {
      const url = item?.url || '';
      const type = String(item?.type || item?.ext || '').toLowerCase();
      if (!url || (type && type !== 'mp4' && !/video/i.test(type))) continue;
      videos.push({
        url,
        quality: item?.quality ?? item?.subname ?? item?.name ?? 'provider',
        width: item?.width ?? null,
        height: item?.height ?? null,
      });
    }
  }
  if (!videos.length) return { ok: false, error: json?.message || json?.error || 'sss-no-video' };
  return { ok: true, value: videos[0] };
}

function pickFastVideoSave(json) {
  const videos = Array.isArray(json?.video) ? json.video : [];
  for (const item of videos) {
    const url = item?.video || item?.url || (typeof item === 'string' ? item : '');
    if (!url) continue;
    return {
      ok: true,
      value: {
        url,
        quality: item?.quality ?? 'provider',
        width: item?.width ?? null,
        height: item?.height ?? null,
      },
    };
  }

  const legacy = Array.isArray(json?.medias)
    ? json.medias
    : Array.isArray(json?.url)
      ? json.url
      : [];
  for (const item of legacy) {
    const url = item?.video || item?.url || (typeof item === 'string' ? item : '');
    if (!url || /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url)) continue;
    return { ok: true, value: { url, quality: item?.quality ?? 'provider', width: null, height: null } };
  }
  return { ok: false, error: json?.message || json?.error || 'fastvideosave-no-video' };
}

async function runSss(page, target) {
  const outcome = deferredResponse(page, {
    match: (response) => /\/api\/convert/i.test(response.url()) && response.request().method() === 'POST',
    pick: pickSss,
  });
  await page.goto('https://sssinstagram.com/reels-downloader', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  const input = page.locator('input[type="text"], input[name="url"], input#main_page_text').first();
  await input.waitFor({ timeout: 15000 });
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
    timeout: 30000,
  });
  await page.waitForTimeout(1000);
  const input = page.locator('input[type="text"], input[type="url"], input[name*="url" i], input[placeholder*="link" i], input[placeholder*="url" i]').first();
  await input.waitFor({ timeout: 15000 });
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

export async function resolveInstagramProviderVideo(rawUrl) {
  const target = normalizeTarget(rawUrl);
  let browser = null;
  const failures = [];
  try {
    browser = await launchBrowser();
    const providers = [
      ['sssinstagram', runSss],
      ['fastvideosave', runFastVideoSave],
    ];

    for (const [name, run] of providers) {
      const context = await browser.newContext({
        userAgent: UA,
        viewport: { width: 1280, height: 900 },
        locale: 'en-US',
      });
      try {
        const page = await context.newPage();
        const result = await run(page, target);
        if (!result?.url) throw new Error('provider-no-url');
        console.info('[instagram-provider] merged Reel candidate resolved:', JSON.stringify({
          provider: name,
          host: new URL(result.url).hostname,
          quality: result.quality ?? null,
        }));
        return {
          url: result.url,
          sourceUrl: target,
          quality: `Instagram ${name}`,
          width: result.width ?? null,
          height: result.height ?? null,
          ext: 'mp4',
          hasAudio: true,
          source: `instagram-${name}`,
          headers: {
            'User-Agent': UA,
            Referer: name === 'sssinstagram' ? 'https://sssinstagram.com/' : 'https://fastvideosave.net/',
            Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
          },
          filesize: null,
        };
      } catch (error) {
        failures.push(`${name}:${error?.message || error}`);
        console.warn('[instagram-provider] provider failed:', name, error?.message || error);
      } finally {
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser?.close().catch(() => {});
  }

  const error = new Error(`Instagram provider fallback failed (${failures.join('; ')})`);
  error.code = 'INSTAGRAM_PROVIDER_FAILED';
  throw error;
}
