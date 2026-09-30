import chromiumPack from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

const target = process.env.TELEGRAM_POST_SMOKE_URL || 'https://t.me/free3dsky/29983';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function safeUrl(value = '') {
  try {
    const u = new URL(value);
    return { host: u.hostname, path: u.pathname.slice(0, 260), ext: u.pathname.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase() || '', queryKeys: [...u.searchParams.keys()].slice(0, 12) };
  } catch { return null; }
}

function sanitizeJson(value, depth = 0) {
  if (depth > 7) return '[depth]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = safeUrl(value);
    if (parsed) return { url: parsed };
    if (/^[A-Za-z0-9._ -]{1,100}$/.test(value)) return value;
    return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 15).map((item) => sanitizeJson(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value).slice(0, 40)) out[key] = sanitizeJson(child, depth + 1);
    return out;
  }
  return String(value);
}

const executablePath = await chromiumPack.executablePath();
const browser = await playwrightChromium.launch({ args: chromiumPack.args, executablePath, headless: true, timeout: 20000 });
let context;
try {
  context = await browser.newContext({ userAgent: UA, locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const goto = await page.goto('https://telegramdownloader.net/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  console.info('TELEGRAM_PROVIDER_PAGE', JSON.stringify({ status: goto?.status?.() || null, url: safeUrl(page.url()) }));

  const result = await page.evaluate(async (telegramLink) => {
    const cfg = window.TD_CONFIG || {};
    const endpoint = cfg.endpoint || '/proxy.php';
    const tokenResponse = await fetch(`${endpoint}?action=token`, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'fetch' },
    });
    const tokenJson = await tokenResponse.json();
    if (!tokenJson?.token) throw new Error(`token-failed-${tokenResponse.status}`);

    const body = new URLSearchParams();
    body.append('telegram_link', telegramLink);
    body.append('rt', tokenJson.token);
    body.append('hp', '');
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'fetch',
      },
      body: body.toString(),
    });
    let json = null;
    let text = '';
    try { json = await response.clone().json(); } catch { text = await response.text(); }
    return {
      endpoint,
      cfgKeys: Object.keys(cfg),
      tokenStatus: tokenResponse.status,
      postStatus: response.status,
      json,
      text: text.slice(0, 1200),
    };
  }, target);

  console.info('TELEGRAM_PROVIDER_DIRECT_RESULT', JSON.stringify({
    endpoint: result.endpoint,
    cfgKeys: result.cfgKeys,
    tokenStatus: result.tokenStatus,
    postStatus: result.postStatus,
    payload: sanitizeJson(result.json || result.text),
  }));

  const envelope = result.json || {};
  const apiBody = (envelope.data && envelope.data.data) || envelope.data || {};
  if (!(envelope.success && apiBody && apiBody.status === 'success' && apiBody.link)) {
    throw new Error(`provider-download-failed-${result.postStatus}`);
  }

  const mediaUrl = apiBody.link;
  const mediaResponse = await page.request.get(mediaUrl, {
    headers: { Range: 'bytes=0-1023' },
    timeout: 20000,
    failOnStatusCode: false,
  });
  console.info('TELEGRAM_PROVIDER_MEDIA_RANGE', JSON.stringify({
    status: mediaResponse.status(),
    contentType: mediaResponse.headers()['content-type'] || '',
    contentLength: mediaResponse.headers()['content-length'] || '',
    contentRange: mediaResponse.headers()['content-range'] || '',
    url: safeUrl(mediaUrl),
  }));
  if (![200, 206].includes(mediaResponse.status())) throw new Error(`provider-media-http-${mediaResponse.status()}`);
} finally {
  await context?.close().catch(() => {});
  await browser.close().catch(() => {});
}
