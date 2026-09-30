import chromiumPack from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

const target = process.env.TELEGRAM_POST_SMOKE_URL || 'https://t.me/free3dsky/29983';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function safe(value = '') {
  try {
    const u = new URL(value);
    return {
      host: u.hostname,
      path: u.pathname.slice(0, 220),
      ext: u.pathname.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase() || '',
      queryKeys: [...u.searchParams.keys()].slice(0, 10),
    };
  } catch {
    return null;
  }
}

const executablePath = await chromiumPack.executablePath();
const browser = await playwrightChromium.launch({
  args: chromiumPack.args,
  executablePath,
  headless: true,
  timeout: 20000,
});

let context;
try {
  context = await browser.newContext({ userAgent: UA, locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const responseHits = [];
  page.on('response', async (response) => {
    try {
      const url = response.url();
      const parsed = safe(url);
      if (!parsed) return;
      const type = String(response.headers()['content-type'] || '').toLowerCase();
      if (type.includes('json') || type.includes('video') || type.includes('audio') || type.includes('octet-stream') || /download|resolve|api|file|media/i.test(url)) {
        responseHits.push({ status: response.status(), type: type.slice(0, 100), ...parsed });
      }
    } catch {}
  });

  const goto = await page.goto('https://telegramdownloader.net/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  console.info('TELEGRAM_PROVIDER_PAGE', JSON.stringify({ status: goto?.status?.() || null, url: safe(page.url()) }));

  const inputs = page.locator('input');
  const inputCount = await inputs.count();
  let chosen = null;
  for (let i = 0; i < inputCount; i += 1) {
    const item = inputs.nth(i);
    const type = (await item.getAttribute('type').catch(() => '')) || '';
    const placeholder = (await item.getAttribute('placeholder').catch(() => '')) || '';
    if (type.toLowerCase() === 'hidden') continue;
    if (/telegram|t\.me|link|url|paste/i.test(placeholder) || !chosen) chosen = item;
  }
  if (!chosen) throw new Error('provider-input-not-found');
  await chosen.fill(target);

  const buttons = page.locator('button, input[type="submit"]');
  const buttonCount = await buttons.count();
  let clicked = false;
  for (let i = 0; i < buttonCount; i += 1) {
    const item = buttons.nth(i);
    const text = ((await item.innerText().catch(() => '')) || (await item.getAttribute('value').catch(() => '')) || '').trim();
    if (/download|get link|generate|submit/i.test(text)) {
      await item.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) throw new Error('provider-download-button-not-found');

  await page.waitForTimeout(12000);
  const links = await page.locator('a[href]').evaluateAll((nodes) => nodes.map((node) => ({
    href: node.href,
    text: (node.textContent || '').trim().slice(0, 80),
    download: node.getAttribute('download') || '',
  })));
  const candidates = [];
  for (const item of links) {
    if (!/download|save|file|media|cdn|telegram/i.test(item.text + ' ' + item.href) && !item.download) continue;
    const parsed = safe(item.href);
    if (parsed) candidates.push({ text: item.text, download: item.download, ...parsed });
  }
  console.info('TELEGRAM_PROVIDER_RESULT', JSON.stringify({
    pageUrl: safe(page.url()),
    candidates: candidates.slice(0, 30),
    responseHits: responseHits.slice(-40),
  }));

  if (!candidates.length && !responseHits.some((item) => /video|audio|octet-stream/i.test(item.type))) {
    throw new Error('provider-no-download-candidate');
  }
} finally {
  await context?.close().catch(() => {});
  await browser.close().catch(() => {});
}
