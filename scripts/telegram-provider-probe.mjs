import chromiumPack from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

const target = process.env.TELEGRAM_POST_SMOKE_URL || 'https://t.me/free3dsky/29983';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function safeUrl(value = '') {
  try {
    const u = new URL(value);
    return { host: u.hostname, path: u.pathname.slice(0, 240), ext: u.pathname.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase() || '', query: Object.fromEntries([...u.searchParams].slice(0, 12)) };
  } catch { return null; }
}

function sanitizeJson(value, depth = 0) {
  if (depth > 6) return '[depth]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = safeUrl(value);
    if (parsed) return { url: parsed };
    return value.length > 140 ? `${value.slice(0, 140)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitizeJson(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value).slice(0, 30)) out[key] = sanitizeJson(child, depth + 1);
    return out;
  }
  return String(value);
}

async function inspectScript(page) {
  const result = await page.evaluate(async () => {
    const response = await fetch('/script.js');
    const text = await response.text();
    const needles = ['proxy.php', 'action=', 'fetch(', 'FormData', 'recaptcha'];
    const excerpts = [];
    for (const needle of needles) {
      let from = 0;
      while (excerpts.length < 30) {
        const at = text.indexOf(needle, from);
        if (at < 0) break;
        excerpts.push(text.slice(Math.max(0, at - 350), Math.min(text.length, at + 900)));
        from = at + needle.length;
      }
    }
    return { bytes: text.length, excerpts };
  });
  console.info('TELEGRAM_PROVIDER_SCRIPT', JSON.stringify(result));
}

const executablePath = await chromiumPack.executablePath();
const browser = await playwrightChromium.launch({ args: chromiumPack.args, executablePath, headless: true, timeout: 20000 });
let context;
try {
  context = await browser.newContext({ userAgent: UA, locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const responseHits = [];
  const proxyBodies = [];

  page.on('response', async (response) => {
    try {
      const url = response.url();
      const parsed = safeUrl(url);
      if (!parsed) return;
      const type = String(response.headers()['content-type'] || '').toLowerCase();
      if (type.includes('json') || /proxy\.php|download|resolve|api|file|media/i.test(url)) {
        responseHits.push({ status: response.status(), type: type.slice(0, 100), ...parsed });
      }
      if (/telegramdownloader\.net\/proxy\.php/i.test(url) && type.includes('json')) {
        const text = await response.text().catch(() => '');
        let body = text;
        try { body = sanitizeJson(JSON.parse(text)); } catch { body = text.slice(0, 1000); }
        proxyBodies.push({ status: response.status(), requestMethod: response.request().method(), requestPostData: response.request().postData()?.slice(0, 1200) || '', url: parsed, body });
      }
    } catch {}
  });

  const goto = await page.goto('https://telegramdownloader.net/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  console.info('TELEGRAM_PROVIDER_PAGE', JSON.stringify({ status: goto?.status?.() || null, url: safeUrl(page.url()) }));
  await inspectScript(page);

  const inputs = page.locator('input');
  let chosen = null;
  for (let i = 0; i < await inputs.count(); i += 1) {
    const item = inputs.nth(i);
    const type = (await item.getAttribute('type').catch(() => '')) || '';
    const placeholder = (await item.getAttribute('placeholder').catch(() => '')) || '';
    if (type.toLowerCase() === 'hidden') continue;
    if (/telegram|t\.me|link|url|paste/i.test(placeholder) || !chosen) chosen = item;
  }
  if (!chosen) throw new Error('provider-input-not-found');
  await chosen.fill(target);

  const buttons = page.locator('button, input[type="submit"]');
  let clicked = false;
  for (let i = 0; i < await buttons.count(); i += 1) {
    const item = buttons.nth(i);
    const text = ((await item.innerText().catch(() => '')) || (await item.getAttribute('value').catch(() => '')) || '').trim();
    if (/download|get link|generate|submit/i.test(text)) { await item.click(); clicked = true; break; }
  }
  if (!clicked) throw new Error('provider-download-button-not-found');

  await page.waitForTimeout(12000);
  console.info('TELEGRAM_PROVIDER_API', JSON.stringify({ proxyBodies, responseHits: responseHits.slice(-40) }));
  if (!proxyBodies.length) throw new Error('provider-proxy-response-not-captured');
} finally {
  await context?.close().catch(() => {});
  await browser.close().catch(() => {});
}
