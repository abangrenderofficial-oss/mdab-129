const input = process.env.TELEGRAM_POST_SMOKE_URL || 'https://t.me/free3dsky/29983';

function parsePostUrl(raw) {
  const u = new URL(raw);
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || !/^\d+$/.test(parts[1])) throw new Error('telegram-post-url-invalid');
  return { channel: parts[0], postId: parts[1] };
}

function decodeHtml(value = '') {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x2F;', '/')
    .replaceAll('\\u0026', '&')
    .replaceAll('\\/', '/');
}

function safeUrl(raw) {
  const value = decodeHtml(raw);
  try {
    const u = new URL(value, 'https://t.me');
    return {
      host: u.hostname,
      path: u.pathname.slice(0, 180),
      ext: u.pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() || '',
      queryKeys: [...u.searchParams.keys()].slice(0, 8),
    };
  } catch {
    return null;
  }
}

function blockForPost(html, channel, postId) {
  const needle = `data-post="${channel}/${postId}"`;
  const at = html.indexOf(needle);
  if (at < 0) return '';
  const start = Math.max(0, html.lastIndexOf('<div class="tgme_widget_message_wrap', at));
  const next = html.indexOf('<div class="tgme_widget_message_wrap', at + needle.length);
  return html.slice(start, next > at ? next : Math.min(html.length, at + 60000));
}

function summarizeBlock(block) {
  const classes = [...block.matchAll(/class=(['"])(.*?)\1/gi)]
    .flatMap((m) => String(m[2] || '').split(/\s+/))
    .filter((v) => /^tgme_widget_message_/.test(v));
  const urls = [];
  for (const match of block.matchAll(/(?:href|src)=(['"])(.*?)\1/gi)) {
    const parsed = safeUrl(match[2]);
    if (parsed) urls.push({ attr: match[0].startsWith('href') ? 'href' : 'src', ...parsed });
  }
  for (const match of block.matchAll(/url\((['"]?)(https?:\/\/[^)'"\s]+)\1\)/gi)) {
    const parsed = safeUrl(match[2]);
    if (parsed) urls.push({ attr: 'css-url', ...parsed });
  }
  const uniqueUrls = [];
  const seen = new Set();
  for (const item of urls) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueUrls.push(item);
  }
  return {
    bytes: block.length,
    classes: [...new Set(classes)].sort(),
    urls: uniqueUrls.slice(0, 40),
    flags: {
      document: /tgme_widget_message_document/i.test(block),
      video: /tgme_widget_message_video/i.test(block),
      photo: /tgme_widget_message_photo/i.test(block),
      audio: /tgme_widget_message_audio/i.test(block),
      voice: /tgme_widget_message_voice/i.test(block),
      fileName: /tgme_widget_message_document_title|tgme_widget_message_document_extra/i.test(block),
    },
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  });
  return { response, html: await response.text() };
}

const { channel, postId } = parsePostUrl(input);
const targets = [
  `https://t.me/${channel}/${postId}?embed=1&mode=tme`,
  `https://t.me/s/${channel}?before=${Number(postId) + 1}`,
  `https://t.me/s/${channel}/${postId}`,
];

let found = false;
for (const target of targets) {
  try {
    const { response, html } = await fetchHtml(target);
    const block = blockForPost(html, channel, postId);
    const summary = summarizeBlock(block);
    console.info('TELEGRAM_POST_PROBE', JSON.stringify({
      target: new URL(target).pathname + new URL(target).search,
      status: response.status,
      finalHost: new URL(response.url).hostname,
      htmlBytes: html.length,
      found: Boolean(block),
      summary,
    }));
    if (block) found = true;
  } catch (error) {
    console.error('TELEGRAM_POST_PROBE_ERROR', JSON.stringify({
      target: new URL(target).pathname + new URL(target).search,
      error: error?.message || String(error),
    }));
  }
}

if (!found) throw new Error('telegram-post-not-found-in-public-preview');
