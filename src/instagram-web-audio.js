const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MOBILE_UA = 'Instagram 275.0.0.27.98 Android (33/13; 280dpi; 720x1423; Xiaomi; Redmi 7; onclite; qcom; en_US; 458229237)';
const FALLBACK_APP_ID = '936619743392459';

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

function parseJson(text = '') {
  let value = String(text || '').replace(/^\uFEFF/, '').trim();
  value = value
    .replace(/^for\s*\(;;\)\s*;\s*/i, '')
    .replace(/^while\s*\(1\)\s*;\s*/i, '')
    .replace(/^\)\]\}',?\s*/, '')
    .trim();
  try { return JSON.parse(value); } catch { return null; }
}

function normalize(value = '') {
  return String(value)
    .replaceAll('\\\\u0026', '&')
    .replaceAll('\\u0026', '&')
    .replaceAll('&amp;', '&')
    .replaceAll('\\/', '/')
    .replaceAll('\\"', '"');
}

function cookieHeader(response) {
  const values = typeof response?.headers?.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response?.headers?.get?.('set-cookie') || ''];
  return values
    .filter(Boolean)
    .map((value) => String(value).split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function cookieValue(header, name) {
  return String(header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || '';
}

function pageConfig(html = '', cookies = '') {
  const csrfFromHtml = String(html).match(/"csrf_token"\s*:\s*"([^"]+)"/i)?.[1] || '';
  const appId = String(html).match(/"appId"\s*:\s*"?(\d+)"?/i)?.[1] || FALLBACK_APP_ID;
  return {
    csrf: cookieValue(cookies, 'csrftoken') || csrfFromHtml,
    appId,
  };
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  return fetch(url, {
    redirect: 'follow',
    ...options,
    signal: AbortSignal.timeout(Math.max(5000, Number(timeoutMs || 20000))),
  });
}

async function resolveMediaId(code) {
  const endpoint = new URL('https://i.instagram.com/api/v1/oembed/');
  endpoint.searchParams.set('url', `https://www.instagram.com/p/${code}/`);
  const response = await fetchWithTimeout(endpoint, {
    headers: {
      'User-Agent': MOBILE_UA,
      'x-ig-app-locale': 'en_US',
      'x-ig-device-locale': 'en_US',
      'accept-language': 'en-US',
      'x-fb-http-engine': 'Liger',
      'x-fb-client-ip': 'True',
      'x-fb-server-cluster': 'True',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`oembed-http-${response.status}`);
  const mediaId = String(parseJson(text)?.media_id || '').trim();
  if (!mediaId) throw new Error('oembed-no-media-id');
  return mediaId;
}

export async function resolveInstagramWebAudio(rawUrl) {
  const canonical = canonicalUrl(rawUrl);
  const code = shortcode(canonical);
  if (!code) {
    const error = new Error('Instagram shortcode is missing.');
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  const mediaId = await resolveMediaId(code);
  const pageResponse = await fetchWithTimeout(canonical, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': BROWSER_UA,
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  const html = await pageResponse.text();
  if (!pageResponse.ok) {
    const error = new Error(`Instagram page HTTP ${pageResponse.status}`);
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  const cookies = cookieHeader(pageResponse);
  const { csrf, appId } = pageConfig(html, cookies);
  console.info('[instagram-audio] web media-info session:', JSON.stringify({
    code,
    mediaId,
    hasCookies: Boolean(cookies),
    hasCsrf: Boolean(csrf),
    appId,
  }));

  const infoResponse = await fetchWithTimeout(
    `https://www.instagram.com/api/v1/media/${encodeURIComponent(mediaId)}/info/`,
    {
      headers: {
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': BROWSER_UA,
        Referer: canonical,
        Origin: 'https://www.instagram.com',
        'X-IG-App-ID': appId,
        'X-ASBD-ID': '359341',
        'X-IG-WWW-Claim': '0',
        'X-Requested-With': 'XMLHttpRequest',
        ...(csrf ? { 'X-CSRFToken': csrf } : {}),
        ...(cookies ? { Cookie: cookies } : {}),
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    },
  );

  const text = await infoResponse.text();
  if (!infoResponse.ok) {
    const contentType = infoResponse.headers.get('content-type') || '';
    const error = new Error(`web-media-info-http-${infoResponse.status}:${contentType.split(';')[0] || 'unknown'}`);
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  const json = parseJson(text);
  if (!json) {
    const contentType = infoResponse.headers.get('content-type') || '';
    const error = new Error(`web-media-info-invalid-json:${contentType.split(';')[0] || 'unknown'}`);
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  const item = json?.items?.[0] || json?.item || json;
  const candidates = collectSocialAudio(item);
  if (!candidates.length) {
    const clips = item?.clips_metadata || null;
    console.warn('[instagram-audio] web media-info has no social sound URL:', JSON.stringify({
      code,
      hasClipsMetadata: Boolean(clips),
      audioType: clips?.audio_type || null,
      hasMusicInfo: Boolean(clips?.music_info),
      hasOriginalSoundInfo: Boolean(clips?.original_sound_info),
      musicCanonicalId: clips?.music_canonical_id || null,
    }));
    const error = new Error('web-media-info-no-social-sound-url');
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  const best = candidates[0];
  console.info('[instagram-audio] web social sound found:', JSON.stringify({
    code,
    mediaId,
    path: best.path,
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
    source: 'instagram-web-media-info',
    startTimeMs: best.startTimeMs || 0,
    durationMs: best.durationMs || null,
    headers: {
      Referer: canonical,
      'User-Agent': BROWSER_UA,
      Accept: 'audio/mp4,audio/*;q=0.9,*/*;q=0.8',
    },
  };
}
