const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const IOS_UA = 'Instagram 377.0.0.0.50 iOS (18_5; iPhone17,2; en_US; en; scale=3.00; 1320x2868; 723588494)';
const ANDROID_UA = 'Instagram 435.0.0.37.76 Android (30/11; 420dpi; 1080x2400; Google; Pixel 7; panther; en_US)';
const WEB_APP_ID = '936619743392459';
const IOS_APP_ID = '124024574287414';
const ANDROID_APP_ID = '567067343352427';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function canonicalUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function shortcode(rawUrl) {
  try { return new URL(rawUrl).pathname.match(/\/(?:reel|reels|p)\/([^/?#]+)/i)?.[1] || ''; } catch { return ''; }
}

function mediaIdFromShortcode(input = '') {
  const code = String(input).length > 28 ? String(input).slice(0, -28) : String(input);
  let value = 0n;
  for (const char of code) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return '';
    value = value * 64n + BigInt(digit);
  }
  return value ? value.toString() : '';
}

function normalize(value = '') {
  return String(value)
    .replaceAll('\\\\u0026', '&')
    .replaceAll('\\u0026', '&')
    .replaceAll('&amp;', '&')
    .replaceAll('\\/', '/')
    .replaceAll('\\"', '"');
}

function parseMetaJson(text = '') {
  let value = String(text || '').replace(/^\uFEFF/, '').trim();
  for (let i = 0; i < 4; i += 1) {
    const before = value;
    value = value
      .replace(/^for\s*\(;;\)\s*;\s*/i, '')
      .replace(/^while\s*\(1\)\s*;\s*/i, '')
      .replace(/^\)\]\}',?\s*/, '')
      .trim();
    if (value === before) break;
  }
  try { return JSON.parse(value); } catch { return null; }
}

function apiHeaders(appId = WEB_APP_ID, userAgent = BROWSER_UA) {
  return {
    'X-IG-App-ID': appId,
    'X-ASBD-ID': '359341',
    'X-IG-WWW-Claim': '0',
    Origin: 'https://www.instagram.com',
    Referer: 'https://www.instagram.com/',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': userAgent,
  };
}

function audioHeaders(canonical) {
  return {
    Referer: canonical,
    'User-Agent': BROWSER_UA,
    Accept: 'audio/mp4,audio/*;q=0.9,*/*;q=0.8',
  };
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(5000, Number(process.env.INSTAGRAM_AUDIO_METADATA_TIMEOUT_MS || 20000)));
  try { return await fetch(url, { redirect: 'follow', ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function parseBaseUrls(xml = '') {
  const out = [];
  for (const match of String(xml).matchAll(/<BaseURL[^>]*>(https?:\/\/[^<]+)<\/BaseURL>/gi)) {
    const raw = normalize(match[1]);
    try { out.push(new URL(raw).toString()); } catch {}
  }
  return out;
}

function audioContext(path = []) {
  return path.some((key) => /audio|music|sound/i.test(String(key)));
}

function collectCandidates(root) {
  const result = [];
  const seenObjects = new WeakSet();
  const seenUrls = new Set();

  const add = (rawUrl, path, meta) => {
    try {
      const url = new URL(normalize(rawUrl)).toString();
      if (seenUrls.has(url)) return;
      seenUrls.add(url);
      result.push({ url, path, ...meta });
    } catch {}
  };

  const visit = (node, path = [], inherited = {}) => {
    if (!node || typeof node !== 'object' || seenObjects.has(node)) return;
    seenObjects.add(node);
    const meta = {
      startTimeMs: Number(node.audio_asset_start_time_in_ms ?? inherited.startTimeMs ?? 0) || 0,
      durationMs: Number(node.duration_in_ms ?? inherited.durationMs ?? 0) || null,
    };

    for (const [key, child] of Object.entries(node)) {
      const childPath = [...path, key];
      if (typeof child === 'string') {
        const isAudio = audioContext(childPath);
        if (isAudio && (key === 'progressive_download_url' || /audio.*url|url.*audio/i.test(key))) {
          add(child, childPath.join('.'), meta);
        } else if (isAudio && /dash_manifest/i.test(key)) {
          for (const url of parseBaseUrls(child)) add(url, `${childPath.join('.')}<BaseURL>`, meta);
        }
      } else if (child && typeof child === 'object') {
        visit(child, childPath, meta);
      }
    }
  };

  visit(root);
  return result.sort((a, b) => Number(/progressive_download_url/i.test(b.path)) - Number(/progressive_download_url/i.test(a.path)));
}

function collectFromText(text = '', code = '') {
  const normalized = normalize(text);
  const anchor = code ? normalized.indexOf(`"code":"${code}"`) : -1;
  const result = [];
  const seen = new Set();
  for (const match of normalized.matchAll(/"progressive_download_url"\s*:\s*"(https?:\/\/[^"\s]+)"/gi)) {
    const index = Number(match.index || 0);
    const nearby = normalized.slice(Math.max(0, index - 12000), Math.min(normalized.length, index + 12000));
    if (!/music_info|music_asset|original_sound|audio_asset|audio_cluster/i.test(nearby)) continue;
    try {
      const url = new URL(normalize(match[1])).toString();
      if (seen.has(url)) continue;
      seen.add(url);
      result.push({
        url,
        path: 'embedded.progressive_download_url',
        distance: anchor >= 0 ? Math.abs(index - anchor) : index,
        startTimeMs: Number(nearby.match(/"audio_asset_start_time_in_ms"\s*:\s*(\d+)/i)?.[1] || 0),
        durationMs: Number(nearby.match(/"duration_in_ms"\s*:\s*(\d+)/i)?.[1] || 0) || null,
      });
    } catch {}
  }
  return result.sort((a, b) => a.distance - b.distance);
}

function invalidJsonTag(response, text) {
  const type = String(response?.headers?.get?.('content-type') || '').split(';')[0] || 'unknown';
  const prefix = String(text || '').trim().slice(0, 20).replace(/\s+/g, ' ');
  return `invalid-json:${type}:${prefix || 'empty'}`;
}

async function tryApiMediaInfo(mediaId, failures) {
  const attempts = [
    ['web-api', `https://www.instagram.com/api/v1/media/${mediaId}/info/`, apiHeaders(WEB_APP_ID, BROWSER_UA)],
    ['ios-api', `https://i.instagram.com/api/v1/media/${mediaId}/info/`, apiHeaders(IOS_APP_ID, IOS_UA)],
    ['android-api', `https://i.instagram.com/api/v1/media/${mediaId}/info/`, apiHeaders(ANDROID_APP_ID, ANDROID_UA)],
  ];

  for (const [name, url, headers] of attempts) {
    try {
      const response = await request(url, { headers });
      const text = await response.text();
      if (!response.ok) { failures.push(`${name}:http-${response.status}`); continue; }
      const json = parseMetaJson(text);
      if (!json) { failures.push(`${name}:${invalidJsonTag(response, text)}`); continue; }
      const candidate = collectCandidates(json)[0];
      if (candidate) return { ...candidate, source: name };
      failures.push(`${name}:no-audio-fields`);
    } catch (error) {
      failures.push(`${name}:${error?.message || error}`);
    }
  }
  return null;
}

function cookieHeader(response) {
  const values = typeof response?.headers?.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response?.headers?.get?.('set-cookie') || ''];
  return values.filter(Boolean).map((v) => String(v).split(';')[0]).join('; ');
}

function cookieValue(header, name) {
  return String(header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || '';
}

function lsdToken(text = '') {
  for (const pattern of [
    /\["LSD",\[\],\{"token":"([^"]+)"/,
    /"LSD"[^\n]{0,300}?"token":"([^"]+)"/,
    /"lsd"\s*:\s*"([^"]+)"/i,
  ]) {
    const token = String(text).match(pattern)?.[1];
    if (token) return normalize(token);
  }
  return '';
}

async function tryGraphql(canonical, mediaId, code, failures) {
  try {
    const home = await request('https://www.instagram.com/', { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } });
    const homeText = await home.text();
    if (!home.ok) { failures.push(`graphql-session:http-${home.status}`); return null; }
    const lsd = lsdToken(homeText);
    if (!lsd) { failures.push('graphql-session:no-lsd'); return null; }
    const cookies = cookieHeader(home);
    const csrf = cookieValue(cookies, 'csrftoken');
    const body = new URLSearchParams({
      lsd,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'PolarisLoggedOutDesktopWWWPostRootContentQuery',
      server_timestamps: 'true',
      variables: JSON.stringify({ media_id: mediaId }),
      doc_id: '27130156389949648',
    });
    const response = await request('https://www.instagram.com/api/graphql', {
      method: 'POST',
      body: body.toString(),
      headers: {
        ...apiHeaders(WEB_APP_ID, BROWSER_UA),
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-FB-Friendly-Name': 'PolarisLoggedOutDesktopWWWPostRootContentQuery',
        'X-FB-LSD': lsd,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: canonical,
        ...(cookies ? { Cookie: cookies } : {}),
        ...(csrf ? { 'X-CSRFToken': csrf } : {}),
      },
    });
    const text = await response.text();
    if (!response.ok) { failures.push(`graphql:http-${response.status}`); return null; }
    const json = parseMetaJson(text);
    if (json) {
      const candidate = collectCandidates(json)[0];
      if (candidate) return { ...candidate, source: 'graphql' };
    }
    const embedded = collectFromText(text, code)[0];
    if (embedded) return { ...embedded, source: 'graphql-embedded' };
    failures.push(`graphql:${json ? 'no-audio-fields' : invalidJsonTag(response, text)}`);
  } catch (error) {
    failures.push(`graphql:${error?.message || error}`);
  }
  return null;
}

async function tryPage(canonical, code, failures) {
  for (const url of [canonical, `${canonical}?__a=1&__d=dis`]) {
    try {
      const response = await request(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.instagram.com/' } });
      const text = await response.text();
      if (!response.ok) { failures.push(`page:http-${response.status}`); continue; }
      const json = parseMetaJson(text);
      if (json) {
        const candidate = collectCandidates(json)[0];
        if (candidate) return { ...candidate, source: 'page-json' };
      }
      const embedded = collectFromText(text, code)[0];
      if (embedded) return { ...embedded, source: 'page-embedded' };
      failures.push('page:no-audio-fields');
    } catch (error) {
      failures.push(`page:${error?.message || error}`);
    }
  }
  return null;
}

function toAudioItem(candidate, canonical, code) {
  console.info('[instagram-audio] recovered Instagram Reel audio:', JSON.stringify({
    code,
    source: candidate.source,
    host: new URL(candidate.url).hostname,
    path: candidate.path || null,
    startTimeMs: candidate.startTimeMs || 0,
    durationMs: candidate.durationMs || null,
  }));
  return {
    url: candidate.url,
    ext: 'm4a',
    quality: 'Instagram Reel audio',
    source: `instagram-${candidate.source}`,
    startTimeMs: candidate.startTimeMs || 0,
    durationMs: candidate.durationMs || null,
    headers: audioHeaders(canonical),
  };
}

export async function resolveInstagramAudio(rawUrl) {
  const canonical = canonicalUrl(rawUrl);
  const code = shortcode(canonical);
  const mediaId = mediaIdFromShortcode(code);
  const failures = [];
  if (!mediaId) {
    const error = new Error('Instagram shortcode could not be converted to media ID.');
    error.code = 'INSTAGRAM_AUDIO_NOT_FOUND';
    throw error;
  }

  const api = await tryApiMediaInfo(mediaId, failures);
  if (api) return toAudioItem(api, canonical, code);
  const graphql = await tryGraphql(canonical, mediaId, code, failures);
  if (graphql) return toAudioItem(graphql, canonical, code);
  const page = await tryPage(canonical, code, failures);
  if (page) return toAudioItem(page, canonical, code);

  const error = new Error(`Instagram Reel audio metadata was not found (${failures.join('; ')})`);
  error.code = 'INSTAGRAM_AUDIO_NOT_FOUND';
  throw error;
}
