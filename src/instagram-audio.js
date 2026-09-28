const INSTAGRAM_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const INSTAGRAM_ANDROID_UA = 'Instagram 435.0.0.37.76 Android (30/11; 420dpi; 1080x2400; Google; Pixel 7; panther; en_US)';
const INSTAGRAM_IOS_UA = 'Instagram 377.0.0.0.50 iOS (18_5; iPhone17,2; en_US; en; scale=3.00; 1320x2868; 723588494)';
const WEB_APP_ID = '936619743392459';
const IOS_APP_ID = '124024574287414';
const ANDROID_APP_ID = '567067343352427';
const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function canonicalInstagramUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function reelCode(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname.match(/\/(?:reel|reels|p)\/([^/?#]+)/i)?.[1] || '';
  } catch {
    return '';
  }
}

function shortcodeToMediaId(shortcode = '') {
  const code = String(shortcode || '').length > 28 ? String(shortcode).slice(0, -28) : String(shortcode || '');
  let value = 0n;
  for (const char of code) {
    const digit = SHORTCODE_ALPHABET.indexOf(char);
    if (digit < 0) return '';
    value = (value * 64n) + BigInt(digit);
  }
  return value ? value.toString() : '';
}

function normalizeEmbeddedText(value = '') {
  return String(value)
    .replaceAll('\\\\u0026', '&')
    .replaceAll('\\u0026', '&')
    .replaceAll('&amp;', '&')
    .replaceAll('\\/', '/')
    .replaceAll('\\"', '"');
}

function audioHeaders(canonical, userAgent = INSTAGRAM_BROWSER_UA) {
  return {
    Referer: canonical,
    'User-Agent': userAgent,
    Accept: 'audio/mp4,audio/*;q=0.9,*/*;q=0.8',
  };
}

function apiHeaders(appId = WEB_APP_ID, userAgent = INSTAGRAM_BROWSER_UA) {
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

function parseBaseUrls(xml = '') {
  const urls = [];
  for (const match of String(xml || '').matchAll(/<BaseURL[^>]*>(https?:\/\/[^<]+)<\/BaseURL>/gi)) {
    const raw = normalizeEmbeddedText(match[1]).replaceAll('&amp;', '&');
    try { urls.push(new URL(raw).toString()); } catch {}
  }
  return urls;
}

function pathLooksAudio(path = []) {
  return path.some((part) => /audio|music|sound/i.test(String(part || '')));
}

function collectObjectAudioCandidates(root) {
  const candidates = [];
  const seenObjects = new WeakSet();

  const add = (url, meta = {}) => {
    if (!url || typeof url !== 'string') return;
    const normalized = normalizeEmbeddedText(url);
    try {
      candidates.push({ url: new URL(normalized).toString(), ...meta });
    } catch {}
  };

  const visit = (value, path = [], inheritedMeta = {}) => {
    if (!value || typeof value !== 'object') return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);

    const localMeta = {
      startTimeMs: Number(value.audio_asset_start_time_in_ms ?? inheritedMeta.startTimeMs ?? 0) || 0,
      durationMs: Number(value.duration_in_ms ?? inheritedMeta.durationMs ?? 0) || null,
    };

    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key];
      const audioContext = pathLooksAudio(childPath);

      if (typeof child === 'string') {
        if (key === 'progressive_download_url' && audioContext) {
          add(child, { ...localMeta, path: childPath.join('.') });
        } else if (/audio.*url|url.*audio/i.test(key) && audioContext) {
          add(child, { ...localMeta, path: childPath.join('.') });
        } else if (/dash_manifest/i.test(key) && audioContext) {
          for (const url of parseBaseUrls(child)) {
            add(url, { ...localMeta, path: `${childPath.join('.')}<BaseURL>` });
          }
        }
        continue;
      }

      if (child && typeof child === 'object') visit(child, childPath, localMeta);
    }
  };

  visit(root);
  const deduped = [];
  const seen = new Set();
  for (const item of candidates) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    deduped.push(item);
  }
  return deduped;
}

function collectProgressiveAudio(text, code = '') {
  const normalized = normalizeEmbeddedText(text);
  const anchor = code ? normalized.indexOf(`"code":"${code}"`) : -1;
  const candidates = [];
  const regex = /"progressive_download_url"\s*:\s*"(https?:\/\/[^"\s]+)"/gi;

  for (const match of normalized.matchAll(regex)) {
    const raw = normalizeEmbeddedText(match[1]);
    let url = raw;
    try { url = new URL(raw).toString(); } catch { continue; }
    const index = Number(match.index || 0);
    const nearby = normalized.slice(Math.max(0, index - 12000), Math.min(normalized.length, index + 12000));
    const audioContext = /music_info|music_asset|original_sound|audio_asset|audio_cluster/i.test(nearby);
    if (!audioContext) continue;
    const offsetMatch = nearby.match(/"audio_asset_start_time_in_ms"\s*:\s*(\d+)/i);
    const durationMatch = nearby.match(/"duration_in_ms"\s*:\s*(\d+)/i);
    candidates.push({
      url,
      index,
      distance: anchor >= 0 ? Math.abs(index - anchor) : index,
      startTimeMs: offsetMatch ? Number(offsetMatch[1]) : 0,
      durationMs: durationMatch ? Number(durationMatch[1]) : null,
      path: 'embedded.progressive_download_url',
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const item of candidates.sort((a, b) => a.distance - b.distance)) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    deduped.push(item);
  }
  return deduped;
}

async function fetchResponse(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(5000, Number(process.env.INSTAGRAM_AUDIO_METADATA_TIMEOUT_MS || 20000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { redirect: 'follow', ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchInstagramText(url, headers = {}) {
  const response = await fetchResponse(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': INSTAGRAM_BROWSER_UA,
      Referer: 'https://www.instagram.com/',
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`Instagram metadata HTTP ${response.status}`);
  return { text: await response.text(), response };
}

function pickCandidate(candidates = [], source = '') {
  if (!candidates.length) return null;
  const ranked = [...candidates].sort((a, b) => {
    const aScore = /progressive_download_url/i.test(a.path || '') ? 2 : 1;
    const bScore = /progressive_download_url/i.test(b.path || '') ? 2 : 1;
    return bScore - aScore;
  });
  return { ...ranked[0], source };
}

async function tryProductInfo(canonical, mediaId, failures) {
  const attempts = [
    {
      name: 'web-api',
      url: `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
      headers: apiHeaders(WEB_APP_ID, INSTAGRAM_BROWSER_UA),
    },
    {
      name: 'ios-api',
      url: `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
      headers: apiHeaders(IOS_APP_ID, INSTAGRAM_IOS_UA),
    },
    {
      name: 'android-api',
      url: `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
      headers: apiHeaders(ANDROID_APP_ID, INSTAGRAM_ANDROID_UA),
    },
  ];

  for (const attempt of attempts) {
    try {
      const response = await fetchResponse(attempt.url, { headers: attempt.headers });
      const text = await response.text();
      if (!response.ok) {
        failures.push(`${attempt.name}:http-${response.status}`);
        continue;
      }
      let json;
      try { json = JSON.parse(text); } catch {
        failures.push(`${attempt.name}:invalid-json`);
        continue;
      }
      const candidates = collectObjectAudioCandidates(json);
      const best = pickCandidate(candidates, attempt.name);
      if (best) return best;
      failures.push(`${attempt.name}:no-audio-fields`);
    } catch (error) {
      failures.push(`${attempt.name}:${error?.message || error}`);
    }
  }
  return null;
}

function extractCookieHeader(response) {
  const raw = typeof response?.headers?.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response?.headers?.get?.('set-cookie') || ''];
  return raw.filter(Boolean).map((value) => String(value).split(';')[0]).join('; ');
}

function cookieValue(cookieHeader = '', name = '') {
  return String(cookieHeader).match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || '';
}

function extractLsdToken(text = '') {
  const patterns = [
    /\["LSD",\[\],\{"token":"([^"]+)"/,
    /"LSD"[^\n]{0,300}?"token":"([^"]+)"/,
    /"lsd"\s*:\s*"([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const value = String(text).match(pattern)?.[1];
    if (value) return normalizeEmbeddedText(value);
  }
  return '';
}

async function tryLoggedOutGraphql(canonical, mediaId, failures) {
  try {
    const home = await fetchResponse('https://www.instagram.com/', {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': INSTAGRAM_BROWSER_UA,
      },
    });
    const homeText = await home.text();
    if (!home.ok) {
      failures.push(`graphql-session:http-${home.status}`);
      return null;
    }
    const lsd = extractLsdToken(homeText);
    if (!lsd) {
      failures.push('graphql-session:no-lsd');
      return null;
    }
    const cookieHeader = extractCookieHeader(home);
    const csrf = cookieValue(cookieHeader, 'csrftoken');

    const body = new URLSearchParams();
    body.set('lsd', lsd);
    body.set('fb_api_caller_class', 'RelayModern');
    body.set('fb_api_req_friendly_name', 'PolarisLoggedOutDesktopWWWPostRootContentQuery');
    body.set('server_timestamps', 'true');
    body.set('variables', JSON.stringify({ media_id: mediaId }));
    body.set('doc_id', '27130156389949648');

    const headers = {
      ...apiHeaders(WEB_APP_ID, INSTAGRAM_BROWSER_UA),
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-FB-Friendly-Name': 'PolarisLoggedOutDesktopWWWPostRootContentQuery',
      'X-FB-LSD': lsd,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: canonical,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(csrf ? { 'X-CSRFToken': csrf } : {}),
    };

    const response = await fetchResponse('https://www.instagram.com/api/graphql', {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    const text = await response.text();
    if (!response.ok) {
      failures.push(`graphql:http-${response.status}`);
      return null;
    }
    let json;
    try { json = JSON.parse(text); } catch {
      failures.push('graphql:invalid-json');
      return null;
    }
    const candidates = collectObjectAudioCandidates(json);
    const best = pickCandidate(candidates, 'graphql');
    if (best) return best;

    const embedded = collectProgressiveAudio(text, reelCode(canonical));
    if (embedded.length) return { ...embedded[0], source: 'graphql-embedded' };
    failures.push('graphql:no-audio-fields');
  } catch (error) {
    failures.push(`graphql:${error?.message || error}`);
  }
  return null;
}

export async function resolveInstagramAudio(rawUrl) {
  const canonical = canonicalInstagramUrl(rawUrl);
  const code = reelCode(canonical);
  const mediaId = shortcodeToMediaId(code);
  const failures = [];

  if (mediaId) {
    const apiCandidate = await tryProductInfo(canonical, mediaId, failures);
    if (apiCandidate) {
      console.info('[instagram-audio] recovered audio from Instagram API:', JSON.stringify({
        code,
        source: apiCandidate.source,
        host: new URL(apiCandidate.url).hostname,
        path: apiCandidate.path || null,
        startTimeMs: apiCandidate.startTimeMs || 0,
        durationMs: apiCandidate.durationMs || null,
      }));
      return {
        url: apiCandidate.url,
        ext: 'm4a',
        quality: 'Instagram Reel audio',
        source: `instagram-${apiCandidate.source}`,
        startTimeMs: apiCandidate.startTimeMs || 0,
        durationMs: apiCandidate.durationMs || null,
        headers: audioHeaders(canonical),
      };
    }

    const graphqlCandidate = await tryLoggedOutGraphql(canonical, mediaId, failures);
    if (graphqlCandidate) {
      console.info('[instagram-audio] recovered audio from Instagram GraphQL:', JSON.stringify({
        code,
        source: graphqlCandidate.source,
        host: new URL(graphqlCandidate.url).hostname,
        path: graphqlCandidate.path || null,
        startTimeMs: graphqlCandidate.startTimeMs || 0,
        durationMs: graphqlCandidate.durationMs || null,
      }));
      return {
        url: graphqlCandidate.url,
        ext: 'm4a',
        quality: 'Instagram Reel audio',
        source: `instagram-${graphqlCandidate.source}`,
        startTimeMs: graphqlCandidate.startTimeMs || 0,
        durationMs: graphqlCandidate.durationMs || null,
        headers: audioHeaders(canonical),
      };
    }
  } else {
    failures.push('shortcode-to-media-id:failed');
  }

  const endpoints = [canonical];
  try {
    const jsonUrl = new URL(canonical);
    jsonUrl.searchParams.set('__a', '1');
    jsonUrl.searchParams.set('__d', 'dis');
    endpoints.push(jsonUrl.toString());
  } catch {}

  for (const endpoint of endpoints) {
    try {
      const { text } = await fetchInstagramText(endpoint);
      const candidates = collectProgressiveAudio(text, code);
      if (!candidates.length) {
        failures.push(`${new URL(endpoint).pathname}:no-progressive-audio`);
        continue;
      }
      const best = candidates[0];
      console.info('[instagram-audio] recovered progressive audio metadata:', JSON.stringify({
        code,
        candidates: candidates.length,
        host: new URL(best.url).hostname,
        startTimeMs: best.startTimeMs,
        durationMs: best.durationMs,
      }));
      return {
        url: best.url,
        ext: 'm4a',
        quality: 'Instagram Reel audio',
        source: 'instagram-page-audio',
        startTimeMs: best.startTimeMs,
        durationMs: best.durationMs,
        headers: audioHeaders(canonical),
      };
    } catch (error) {
      failures.push(`${new URL(endpoint).pathname}:${error?.message || error}`);
    }
  }

  const error = new Error(`Instagram Reel audio metadata was not found (${failures.join('; ')})`);
  error.code = 'INSTAGRAM_AUDIO_NOT_FOUND';
  throw error;
}
