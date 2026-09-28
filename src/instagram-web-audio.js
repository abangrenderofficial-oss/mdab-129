const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const APP_ID = '936619743392459';
const GRAPHQL_DOC_ID = '27130156389949648';
const FRIENDLY_NAME = 'PolarisLoggedOutDesktopWWWPostRootContentQuery';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function canonicalUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function shortcode(rawUrl) {
  try { return new URL(rawUrl).pathname.match(/\/(?:reel|reels|p)\/([^/?#]+)/i)?.[1] || ''; }
  catch { return ''; }
}

function shortcodeToPk(code = '') {
  let value = 0n;
  for (const char of String(code)) {
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

function parseJson(text = '') {
  let value = String(text || '').replace(/^\uFEFF/, '').trim();
  value = value
    .replace(/^for\s*\(;;\)\s*;\s*/i, '')
    .replace(/^while\s*\(1\)\s*;\s*/i, '')
    .replace(/^\)\]\}',?\s*/, '')
    .trim();
  try { return JSON.parse(value); } catch { return null; }
}

function setCookies(response) {
  const values = typeof response?.headers?.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response?.headers?.get?.('set-cookie') || ''];
  return values
    .filter(Boolean)
    .map((value) => String(value).split(';')[0])
    .filter(Boolean);
}

function mergeCookies(...groups) {
  const jar = new Map();
  for (const group of groups) {
    for (const pair of group || []) {
      const idx = String(pair).indexOf('=');
      if (idx <= 0) continue;
      jar.set(String(pair).slice(0, idx), String(pair).slice(idx + 1));
    }
  }
  return jar;
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function cookieValue(jar, name) {
  return jar?.get?.(name) || '';
}

function extractLsd(html = '') {
  const text = String(html || '');
  const direct = text.match(/\["LSD",\[\],\{"token":"([^"]+)"/i)?.[1];
  if (direct) return normalize(direct);

  const eqmc = text.match(/<script\b[^>]*\bid="__eqmc"[^>]*>(.*?)<\/script>/is)?.[1];
  if (eqmc) {
    try {
      const parsed = JSON.parse(eqmc);
      if (typeof parsed?.l === 'string' && parsed.l) return parsed.l;
    } catch {}
  }
  return '';
}

function extractHtmlCsrf(html = '') {
  return String(html || '').match(/"csrf_token"\s*:\s*"([^"]+)"/i)?.[1] || '';
}

function candidatePriority(key = '') {
  const value = String(key).toLowerCase();
  if (value === 'fast_start_progressive_download_url') return 120;
  if (value === 'progressive_download_url') return 115;
  if (value === 'reactive_audio_download_url') return 110;
  if (value === 'web_30s_preview_download_url') return 70;
  if (/audio.*url|url.*audio/.test(value)) return 80;
  return 0;
}

function collectSocialAudio(root) {
  const found = [];
  const visited = new WeakSet();
  const seen = new Set();

  function isAudioContext(path) {
    return path.some((part) => /clips_metadata|music_info|music_asset|original_sound|audio_asset|audio_cluster|track/i.test(String(part)));
  }

  function visit(node, path = [], inherited = {}) {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    const meta = {
      startTimeMs: Number(node.audio_asset_start_time_in_ms ?? node.audio_asset_start_time_ms ?? inherited.startTimeMs ?? 0) || 0,
      durationMs: Number(node.duration_in_ms ?? inherited.durationMs ?? 0) || null,
      audioAssetId: String(node.audio_asset_id ?? inherited.audioAssetId ?? ''),
      title: String(node.original_audio_title ?? node.title ?? inherited.title ?? ''),
    };

    for (const [key, child] of Object.entries(node)) {
      const childPath = [...path, key];
      if (typeof child === 'string') {
        const priority = candidatePriority(key);
        if (!priority || !isAudioContext(childPath)) continue;
        try {
          const url = new URL(normalize(child)).toString();
          if (!/^https:/i.test(url) || seen.has(url)) continue;
          seen.add(url);
          found.push({ url, priority, path: childPath.join('.'), ...meta });
        } catch {}
      } else if (child && typeof child === 'object') {
        visit(child, childPath, meta);
      }
    }
  }

  visit(root);
  return found.sort((a, b) => b.priority - a.priority);
}

async function request(url, options = {}) {
  return fetch(url, {
    redirect: 'follow',
    ...options,
    signal: AbortSignal.timeout(Math.max(5000, Number(process.env.INSTAGRAM_AUDIO_METADATA_TIMEOUT_MS || 20000))),
  });
}

function baseHeaders() {
  return {
    'User-Agent': BROWSER_UA,
    'X-IG-App-ID': APP_ID,
    'X-ASBD-ID': '198387',
    'X-IG-WWW-Claim': '0',
    Origin: 'https://www.instagram.com',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

async function initializeSession(canonical, code) {
  const homeResponse = await request('https://www.instagram.com/', {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const homeHtml = await homeResponse.text();
  const jar = mergeCookies(setCookies(homeResponse));
  let lsd = extractLsd(homeHtml);
  let htmlCsrf = extractHtmlCsrf(homeHtml);

  try {
    const postResponse = await request(canonical, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://www.instagram.com/',
        ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
      },
    });
    const postHtml = await postResponse.text();
    for (const [key, value] of mergeCookies(setCookies(postResponse))) jar.set(key, value);
    lsd = extractLsd(postHtml) || lsd;
    htmlCsrf = extractHtmlCsrf(postHtml) || htmlCsrf;
  } catch {}

  const mediaId = shortcodeToPk(code);
  if (!mediaId) throw new Error('shortcode-to-pk-failed');

  const ruling = new URL('https://www.instagram.com/api/v1/web/get_ruling_for_content/');
  ruling.searchParams.set('content_type', 'MEDIA');
  ruling.searchParams.set('target_id', mediaId);
  const rulingResponse = await request(ruling, {
    headers: {
      ...baseHeaders(),
      Referer: canonical,
      ...(jar.size ? { Cookie: cookieHeader(jar) } : {}),
    },
  });
  const rulingText = await rulingResponse.text();
  for (const [key, value] of mergeCookies(setCookies(rulingResponse))) jar.set(key, value);
  const apiCheck = parseJson(rulingText) || {};
  const cookieCsrf = cookieValue(jar, 'csrftoken');
  const csrf = apiCheck?.status === 'ok' ? (cookieCsrf || htmlCsrf) : '';

  console.info('[instagram-audio] current yt-dlp session:', JSON.stringify({
    code,
    mediaId,
    rulingStatus: rulingResponse.status,
    rulingApiStatus: apiCheck?.status || null,
    cookieNames: [...jar.keys()],
    hasLsd: Boolean(lsd),
    hasCookieCsrf: Boolean(cookieCsrf),
    hasHtmlCsrf: Boolean(htmlCsrf),
    hasGrantedCsrf: Boolean(csrf),
  }));

  return { mediaId, jar, lsd, csrf, apiCheck };
}

async function fetchSessionedMediaInfo(canonical, session) {
  const attempts = [
    `https://i.instagram.com/api/v1/media/${encodeURIComponent(session.mediaId)}/info/`,
    `https://www.instagram.com/api/v1/media/${encodeURIComponent(session.mediaId)}/info/`,
  ];

  const failures = [];
  for (const endpoint of attempts) {
    try {
      const response = await request(endpoint, {
        headers: {
          ...baseHeaders(),
          Referer: canonical,
          'X-Requested-With': 'XMLHttpRequest',
          ...(session.csrf ? { 'X-CSRFToken': session.csrf } : {}),
          ...(session.jar?.size ? { Cookie: cookieHeader(session.jar) } : {}),
        },
      });
      const text = await response.text();
      const json = parseJson(text);
      if (!response.ok || !json) {
        failures.push(`${new URL(endpoint).hostname}:${response.status}:${response.headers.get('content-type') || 'unknown'}`);
        continue;
      }
      const item = json?.items?.[0] || json?.item || null;
      if (!item) {
        failures.push(`${new URL(endpoint).hostname}:no-item`);
        continue;
      }
      const candidates = collectSocialAudio(item);
      console.info('[instagram-audio] sessioned media-info response:', JSON.stringify({
        host: new URL(endpoint).hostname,
        status: response.status,
        hasAudio: item?.has_audio ?? null,
        hasClipsMetadata: Boolean(item?.clips_metadata),
        hasMusicInfo: Boolean(item?.clips_metadata?.music_info),
        hasOriginalSoundInfo: Boolean(item?.clips_metadata?.original_sound_info),
        candidates: candidates.length,
      }));
      if (candidates.length) return candidates[0];
      failures.push(`${new URL(endpoint).hostname}:no-social-audio`);
    } catch (error) {
      failures.push(`${new URL(endpoint).hostname}:${error?.message || error}`);
    }
  }

  const error = new Error(`sessioned-media-info-failed:${failures.join(',')}`);
  error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
  throw error;
}

async function fetchCurrentGraphQl(canonical, session) {
  if (!session?.lsd) {
    const error = new Error('current-graphql-no-lsd-token');
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  const body = new URLSearchParams({
    lsd: session.lsd,
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: FRIENDLY_NAME,
    server_timestamps: 'true',
    variables: JSON.stringify({ media_id: session.mediaId }),
    doc_id: GRAPHQL_DOC_ID,
  }).toString();

  const response = await request('https://www.instagram.com/api/graphql', {
    method: 'POST',
    headers: {
      ...baseHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-FB-Friendly-Name': FRIENDLY_NAME,
      'X-FB-LSD': session.lsd,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: canonical,
      ...(session.csrf ? { 'X-CSRFToken': session.csrf } : {}),
      ...(session.jar?.size ? { Cookie: cookieHeader(session.jar) } : {}),
    },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`current-graphql-http-${response.status}`);
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }
  const json = parseJson(text);
  if (!json) {
    const error = new Error(`current-graphql-invalid-json:${response.headers.get('content-type') || 'unknown'}`);
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  const media = json?.data?.xig_polaris_media || null;
  const product = media?.if_not_gated_logged_out || null;
  if (!product || typeof product !== 'object') {
    const error = new Error(`current-graphql-no-product:${json?.errors?.[0]?.message || 'empty'}`);
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }
  return product;
}

function toAudio(best, canonical, source) {
  console.info('[instagram-audio] Instagram social sound found:', JSON.stringify({
    source,
    path: best.path || null,
    host: new URL(best.url).hostname,
    audioAssetId: best.audioAssetId || null,
    title: best.title || null,
    startTimeMs: best.startTimeMs || 0,
    durationMs: best.durationMs || null,
  }));
  return {
    url: best.url,
    ext: /\.m4a(?:\?|$)/i.test(best.url) ? 'm4a' : 'mp4',
    quality: 'Instagram social sound',
    source,
    startTimeMs: best.startTimeMs || 0,
    durationMs: best.durationMs || null,
    headers: {
      Referer: canonical,
      'User-Agent': BROWSER_UA,
      Accept: 'audio/mp4,audio/*;q=0.9,*/*;q=0.8',
    },
  };
}

export async function resolveInstagramWebAudio(rawUrl) {
  const canonical = canonicalUrl(rawUrl);
  const code = shortcode(canonical);
  if (!code) {
    const error = new Error('Instagram shortcode is missing.');
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  const session = await initializeSession(canonical, code);

  try {
    const mediaInfoAudio = await fetchSessionedMediaInfo(canonical, session);
    if (mediaInfoAudio?.url) return toAudio(mediaInfoAudio, canonical, 'instagram-session-media-info');
  } catch (error) {
    console.warn('[instagram-audio] sessioned media-info did not expose social sound:', error?.message || error);
  }

  const product = await fetchCurrentGraphQl(canonical, session);
  const candidates = collectSocialAudio(product);
  if (!candidates.length) {
    const clips = product?.clips_metadata || null;
    console.warn('[instagram-audio] current GraphQL has no social sound URL:', JSON.stringify({
      code,
      hasClipsMetadata: Boolean(clips),
      audioType: clips?.audio_type || null,
      hasMusicInfo: Boolean(clips?.music_info),
      hasOriginalSoundInfo: Boolean(clips?.original_sound_info),
      musicCanonicalId: clips?.music_canonical_id || null,
    }));
    const error = new Error('current-graphql-no-social-sound-url');
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  return toAudio(candidates[0], canonical, 'instagram-current-graphql');
}
