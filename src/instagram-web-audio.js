const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const APP_ID = '936619743392459';
const GRAPHQL_DOC_ID = '8845758582119845';
const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

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
    const digit = SHORTCODE_ALPHABET.indexOf(char);
    if (digit < 0) return '';
    value = value * 64n + BigInt(digit);
  }
  return value ? value.toString() : '';
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

function cookiePairs(response) {
  const values = typeof response?.headers?.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response?.headers?.get?.('set-cookie') || ''];
  return values
    .filter(Boolean)
    .map((value) => String(value).split(';')[0])
    .filter(Boolean);
}

function cookieValue(pairs = [], name) {
  for (const pair of pairs) {
    const match = String(pair).match(new RegExp(`^${name}=([^;]+)$`));
    if (match?.[1]) return match[1];
  }
  return '';
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

async function setupRulingSession(code) {
  const pk = shortcodeToPk(code);
  if (!pk) throw new Error('shortcode-to-pk-failed');

  const rulingUrl = new URL('https://i.instagram.com/api/v1/web/get_ruling_for_content/');
  rulingUrl.searchParams.set('content_type', 'MEDIA');
  rulingUrl.searchParams.set('target_id', pk);

  const response = await fetchWithTimeout(rulingUrl, {
    headers: {
      'User-Agent': BROWSER_UA,
      'X-IG-App-ID': APP_ID,
      'X-IG-WWW-Claim': '0',
      Origin: 'https://www.instagram.com',
      Accept: '*/*',
    },
  });

  const pairs = cookiePairs(response);
  const csrf = cookieValue(pairs, 'csrftoken');
  console.info('[instagram-audio] ruling session:', JSON.stringify({
    code,
    pk,
    status: response.status,
    hasCookies: pairs.length > 0,
    hasCsrf: Boolean(csrf),
  }));

  return {
    pk,
    cookies: pairs.join('; '),
    csrf,
  };
}

async function fetchGraphQlMedia(code, session) {
  const variables = {
    shortcode: code,
    child_comment_count: 3,
    fetch_comment_count: 40,
    parent_comment_count: 24,
    has_threaded_comments: true,
  };

  const body = new URLSearchParams();
  body.set('variables', JSON.stringify(variables));
  body.set('doc_id', GRAPHQL_DOC_ID);

  const response = await fetchWithTimeout('https://www.instagram.com/graphql/query/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-IG-App-ID': APP_ID,
      'X-ASBD-ID': '198387',
      'X-IG-WWW-Claim': '0',
      'User-Agent': BROWSER_UA,
      Referer: 'https://www.instagram.com/',
      Origin: 'https://www.instagram.com',
      'X-Requested-With': 'XMLHttpRequest',
      ...(session?.csrf ? { 'X-CSRFToken': session.csrf } : {}),
      ...(session?.cookies ? { Cookie: session.cookies } : {}),
    },
    body: body.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`ruling-graphql-http-${response.status}`);
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  const json = parseJson(text);
  if (!json) {
    const contentType = response.headers.get('content-type') || '';
    const error = new Error(`ruling-graphql-invalid-json:${contentType.split(';')[0] || 'unknown'}`);
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  const media = json?.data?.xdt_shortcode_media || json?.data?.shortcode_media || null;
  if (!media || typeof media !== 'object') {
    const message = json?.errors?.[0]?.message || 'no-media';
    const error = new Error(`ruling-graphql-${message}`);
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  return media;
}

export async function resolveInstagramWebAudio(rawUrl) {
  const canonical = canonicalUrl(rawUrl);
  const code = shortcode(canonical);
  if (!code) {
    const error = new Error('Instagram shortcode is missing.');
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  let session;
  try {
    session = await setupRulingSession(code);
  } catch (error) {
    const wrapped = new Error(`ruling-session-failed:${error?.message || error}`);
    wrapped.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw wrapped;
  }

  const media = await fetchGraphQlMedia(code, session);
  const candidates = collectSocialAudio(media);
  if (!candidates.length) {
    const clips = media?.clips_metadata || null;
    console.warn('[instagram-audio] ruling GraphQL has no social sound URL:', JSON.stringify({
      code,
      hasClipsMetadata: Boolean(clips),
      audioType: clips?.audio_type || null,
      hasMusicInfo: Boolean(clips?.music_info),
      hasOriginalSoundInfo: Boolean(clips?.original_sound_info),
      musicCanonicalId: clips?.music_canonical_id || null,
    }));
    const error = new Error('ruling-graphql-no-social-sound-url');
    error.code = 'INSTAGRAM_WEB_AUDIO_NOT_FOUND';
    throw error;
  }

  const best = candidates[0];
  console.info('[instagram-audio] ruling GraphQL social sound found:', JSON.stringify({
    code,
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
    source: 'instagram-ruling-graphql',
    startTimeMs: best.startTimeMs || 0,
    durationMs: best.durationMs || null,
    headers: {
      Referer: canonical,
      'User-Agent': BROWSER_UA,
      Accept: 'audio/mp4,audio/*;q=0.9,*/*;q=0.8',
    },
  };
}
