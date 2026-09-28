const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MOBILE_UA = 'Instagram 275.0.0.27.98 Android (33/13; 280dpi; 720x1423; Xiaomi; Redmi 7; onclite; qcom; en_US; 458229237)';
const WEB_APP_ID = '936619743392459';

const MOBILE_HEADERS = {
  'x-ig-app-locale': 'en_US',
  'x-ig-device-locale': 'en_US',
  'x-ig-mapped-locale': 'en_US',
  'user-agent': MOBILE_UA,
  'accept-language': 'en-US',
  'x-fb-http-engine': 'Liger',
  'x-fb-client-ip': 'True',
  'x-fb-server-cluster': 'True',
  'content-length': '0',
};

const EMBED_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'max-age=0',
  Dnt: '1',
  Priority: 'u=0, i',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': BROWSER_UA,
};

function canonicalUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function shortcode(rawUrl) {
  try {
    return new URL(rawUrl).pathname.match(/\/(?:reel|reels|p)\/([^/?#]+)/i)?.[1] || '';
  } catch {
    return '';
  }
}

function normalize(value = '') {
  return String(value)
    .replaceAll('\\\\u0026', '&')
    .replaceAll('\\u0026', '&')
    .replaceAll('&amp;', '&')
    .replaceAll('\\/', '/')
    .replaceAll('\\"', '"');
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(5000, Number(process.env.INSTAGRAM_AUDIO_METADATA_TIMEOUT_MS || 20000)),
  );
  try {
    return await fetch(url, { redirect: 'follow', ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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

function audioHeaders(canonical) {
  return {
    Referer: canonical,
    'User-Agent': BROWSER_UA,
    Accept: 'video/mp4,audio/mp4,audio/*;q=0.9,*/*;q=0.8',
  };
}

function looksLikeAudioPath(path = []) {
  return path.some((part) => /audio|music|sound|track/i.test(String(part || '')));
}

function candidatePriority(key = '') {
  const value = String(key).toLowerCase();
  if (value === 'fast_start_progressive_download_url') return 110;
  if (value === 'progressive_download_url') return 105;
  if (value === 'reactive_audio_download_url') return 100;
  if (value === 'web_30s_preview_download_url') return 75;
  if (/audio.*url|url.*audio/.test(value)) return 70;
  if (value === 'uri') return 50;
  return 0;
}

function collectAudioCandidates(root) {
  const result = [];
  const visited = new WeakSet();
  const seen = new Set();

  function add(rawUrl, key, path, inherited) {
    const priority = candidatePriority(key);
    if (!priority || !looksLikeAudioPath(path)) return;
    try {
      const url = new URL(normalize(rawUrl)).toString();
      if (!/^https:/i.test(url) || seen.has(url)) return;
      seen.add(url);
      result.push({
        url,
        priority,
        path: path.join('.'),
        startTimeMs: Number(inherited?.startTimeMs || 0) || 0,
        durationMs: Number(inherited?.durationMs || 0) || null,
      });
    } catch {}
  }

  function visit(node, path = [], inherited = {}) {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    const meta = {
      startTimeMs: Number(
        node.audio_asset_start_time_in_ms ?? node.audio_asset_start_time_ms ?? inherited.startTimeMs ?? 0,
      ) || 0,
      durationMs: Number(node.duration_in_ms ?? inherited.durationMs ?? 0) || null,
    };
    for (const [key, child] of Object.entries(node)) {
      const childPath = [...path, key];
      if (typeof child === 'string') add(child, key, childPath, meta);
      else if (child && typeof child === 'object') visit(child, childPath, meta);
    }
  }

  visit(root);
  return result.sort((a, b) => b.priority - a.priority);
}

function collectPlaybackCandidates(root) {
  const found = [];
  const visited = new WeakSet();
  const seen = new Set();

  function add(rawUrl, path, width = 0, height = 0, priority = 0) {
    try {
      const url = new URL(normalize(rawUrl)).toString();
      if (!/^https:/i.test(url) || seen.has(url)) return;
      seen.add(url);
      found.push({
        url,
        path: path.join('.'),
        width: Number(width || 0) || 0,
        height: Number(height || 0) || 0,
        priority,
      });
    } catch {}
  }

  function visit(node, path = []) {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node.video_versions)) {
      for (const [index, item] of node.video_versions.entries()) {
        if (item?.url) add(item.url, [...path, 'video_versions', String(index), 'url'], item.width, item.height, 100);
      }
    }

    for (const [key, child] of Object.entries(node)) {
      const childPath = [...path, key];
      if (typeof child === 'string' && /^(?:video_url|playable_url|playback_url)$/i.test(key)) {
        add(child, childPath, node.width, node.height, 90);
      } else if (child && typeof child === 'object') {
        visit(child, childPath);
      }
    }
  }

  visit(root);
  return found.sort((a, b) =>
    b.priority - a.priority ||
    (b.width * b.height) - (a.width * a.height)
  );
}

function extractContextJsonFromEmbed(html = '') {
  const initMatch = String(html).match(/"init",\[\],\[(.*?)\]\],/s);
  if (initMatch?.[1]) {
    try {
      const init = JSON.parse(initMatch[1]);
      if (init?.contextJSON) {
        const context = typeof init.contextJSON === 'string' ? JSON.parse(init.contextJSON) : init.contextJSON;
        if (context && typeof context === 'object') return context;
      }
    } catch {}
  }

  const contextMatch = String(html).match(/"contextJSON"\s*:\s*"((?:\\.|[^"\\])*)"/s);
  if (contextMatch?.[1]) {
    try {
      const decoded = JSON.parse(`"${contextMatch[1]}"`);
      const context = JSON.parse(decoded);
      if (context && typeof context === 'object') return context;
    } catch {}
  }
  return null;
}

async function embedCaptionedAudio(code, failures) {
  try {
    const response = await request(`https://www.instagram.com/p/${encodeURIComponent(code)}/embed/captioned/`, {
      headers: EMBED_HEADERS,
    });
    const text = await response.text();
    if (!response.ok) {
      failures.push(`embed:http-${response.status}`);
      return null;
    }

    const context = extractContextJsonFromEmbed(text);
    if (!context) {
      failures.push('embed:no-context-json');
      return null;
    }

    // Best case: Instagram exposes the music/original-sound asset directly.
    const audioCandidates = collectAudioCandidates(context);
    if (audioCandidates.length) {
      return { ...audioCandidates[0], source: 'embed-sound-asset', ext: 'm4a' };
    }

    // Some Reels do not expose music_info publicly, but the embed still contains
    // the playback MP4 used by Instagram's own player. That playback is an audio
    // carrier: Status HQ will map only its audio stream and mux it onto the HQ
    // video-only source, exactly like TikTok video + data.music.
    const playbackCandidates = collectPlaybackCandidates(context);
    if (playbackCandidates.length) {
      const best = playbackCandidates[0];
      console.info('[instagram-audio] embed playback carrier found:', JSON.stringify({
        code,
        host: new URL(best.url).hostname,
        path: best.path,
        width: best.width || null,
        height: best.height || null,
      }));
      return {
        ...best,
        source: 'embed-playback',
        ext: 'mp4',
        startTimeMs: 0,
        durationMs: null,
      };
    }

    failures.push('embed:no-sound-or-playback');
    return null;
  } catch (error) {
    failures.push(`embed:${error?.message || error}`);
    return null;
  }
}

function getNumberFromQuery(name, data = '') {
  const value = String(data).match(new RegExp(`${name}=(\\d+)`))?.[1];
  return Number(value) || null;
}

function getObjectFromEntries(name, data = '') {
  try {
    const objectText = String(data).match(new RegExp('\\["' + name + '",.*?,({.*?}),\\d+\\]'))?.[1];
    return objectText ? JSON.parse(objectText) : null;
  } catch { return null; }
}

function randomAlpha(length = 8) {
  let out = '';
  while (out.length < length) out += Math.random().toString(36).slice(2).replace(/\d/g, '');
  return out.slice(0, length) || 'abcdef';
}

function randomBase64ish(length = 205) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < length; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function graphQlPlaybackAudio(code, failures) {
  try {
    const pageResponse = await request(`https://www.instagram.com/p/${encodeURIComponent(code)}/`, { headers: EMBED_HEADERS });
    const html = await pageResponse.text();
    if (!pageResponse.ok) {
      failures.push(`graphql-page:http-${pageResponse.status}`);
      return null;
    }

    const siteData = getObjectFromEntries('SiteData', html) || {};
    const polarisSiteData = getObjectFromEntries('PolarisSiteData', html) || {};
    const webConfig = getObjectFromEntries('DGWWebConfig', html) || {};
    const pushInfo = getObjectFromEntries('InstagramWebPushInfo', html) || {};
    const security = getObjectFromEntries('InstagramSecurityConfig', html) || {};
    const lsd = getObjectFromEntries('LSD', html)?.token || randomBase64ish(11);
    const csrf = security?.csrf_token || '';
    const anonCookie = [
      csrf ? `csrftoken=${csrf}` : '',
      polarisSiteData?.device_id ? `ig_did=${polarisSiteData.device_id}` : '',
      'wd=1280x720', 'dpr=2',
      polarisSiteData?.machine_id ? `mid=${polarisSiteData.machine_id}` : '',
      'ig_nrcb=1',
    ].filter(Boolean).join('; ');

    const body = {
      __d: 'www', __a: '1', __s: `::${randomAlpha(6)}`,
      __hs: siteData?.haste_session || '20126.HYP:instagram_web_pkg.2.1...0',
      __req: 'b', __ccg: 'EXCELLENT',
      __rev: pushInfo?.rollout_hash || '1019933358',
      __hsi: siteData?.hsi || '7436540909012459023',
      __dyn: randomBase64ish(205), __csr: randomBase64ish(205), __user: '0',
      __comet_req: String(getNumberFromQuery('__comet_req', html) || 7),
      av: '0', dpr: '2', lsd,
      jazoest: String(getNumberFromQuery('jazoest', html) || Math.floor(Math.random() * 10000)),
      __spin_r: siteData?.__spin_r || '1019933358', __spin_b: siteData?.__spin_b || 'trunk',
      __spin_t: String(siteData?.__spin_t || Math.floor(Date.now() / 1000)),
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'PolarisPostActionLoadPostQueryQuery',
      variables: JSON.stringify({ shortcode: code, fetch_tagged_user_count: null, hoisted_comment_id: null, hoisted_reply_id: null }),
      server_timestamps: 'true', doc_id: '8845758582119845',
    };

    const gqlResponse = await request('https://www.instagram.com/graphql/query', {
      method: 'POST',
      headers: {
        ...EMBED_HEADERS,
        'x-ig-app-id': String(webConfig?.appId || WEB_APP_ID),
        'X-FB-LSD': lsd, 'X-CSRFToken': csrf, 'x-asbd-id': '129477',
        cookie: anonCookie,
        'content-type': 'application/x-www-form-urlencoded',
        'X-FB-Friendly-Name': 'PolarisPostActionLoadPostQueryQuery',
      },
      body: new URLSearchParams(body).toString(),
    });
    const gqlText = await gqlResponse.text();
    if (!gqlResponse.ok) {
      failures.push(`graphql:http-${gqlResponse.status}`);
      return null;
    }
    const gql = parseJson(gqlText);
    const media = gql?.data?.xdt_shortcode_media || gql?.data?.shortcode_media || null;
    const playbackUrl = normalize(media?.video_url || '');
    if (!playbackUrl) {
      failures.push(`graphql:no-video-url:${gql?.errors?.[0]?.message || 'empty'}`);
      return null;
    }
    return { url: playbackUrl, source: 'graphql-playback', path: 'xdt_shortcode_media.video_url', ext: 'mp4', startTimeMs: 0, durationMs: null };
  } catch (error) {
    failures.push(`graphql:${error?.message || error}`);
    return null;
  }
}

async function anonymousMobileMediaInfo(code, failures) {
  try {
    const oembed = new URL('https://i.instagram.com/api/v1/oembed/');
    oembed.searchParams.set('url', `https://www.instagram.com/p/${code}/`);
    const oembedResponse = await request(oembed, { headers: MOBILE_HEADERS });
    const oembedText = await oembedResponse.text();
    if (!oembedResponse.ok) {
      failures.push(`mobile-oembed:http-${oembedResponse.status}`);
      return null;
    }
    const oembedJson = parseJson(oembedText);
    const mediaId = String(oembedJson?.media_id || '').trim();
    if (!mediaId) {
      failures.push('mobile-oembed:no-media-id');
      return null;
    }
    console.info('[instagram-audio] anonymous oEmbed resolved media id:', JSON.stringify({ code, mediaId }));

    const infoResponse = await request(`https://i.instagram.com/api/v1/media/${encodeURIComponent(mediaId)}/info/`, { headers: MOBILE_HEADERS });
    const infoText = await infoResponse.text();
    if (!infoResponse.ok) {
      failures.push(`mobile-info:http-${infoResponse.status}`);
      return null;
    }
    const infoJson = parseJson(infoText);
    const item = infoJson?.items?.[0] || infoJson?.item || null;
    if (!item) {
      failures.push('mobile-info:no-item');
      return null;
    }
    const candidates = collectAudioCandidates(item);
    if (!candidates.length) {
      failures.push('mobile-info:no-audio-fields');
      return null;
    }
    return { ...candidates[0], source: 'anonymous-mobile-info', mediaId, ext: 'm4a' };
  } catch (error) {
    failures.push(`anonymous-mobile:${error?.message || error}`);
    return null;
  }
}

async function pageFallback(canonical, code, failures) {
  const urls = [canonical, `${canonical}?__a=1&__d=dis`];
  for (const url of urls) {
    try {
      const response = await request(url, {
        headers: { Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': BROWSER_UA, Referer: 'https://www.instagram.com/' },
      });
      const text = await response.text();
      if (!response.ok) {
        failures.push(`page:http-${response.status}`);
        continue;
      }
      const json = parseJson(text);
      if (json) {
        const candidates = collectAudioCandidates(json);
        if (candidates.length) return { ...candidates[0], source: 'page-json', ext: 'm4a' };
      }
      const normalized = normalize(text);
      const anchor = normalized.indexOf(`"code":"${code}"`);
      const regex = /"(?:fast_start_)?progressive_download_url"\s*:\s*"(https?:\/\/[^"\s]+)"/gi;
      const found = [];
      for (const match of normalized.matchAll(regex)) {
        const index = Number(match.index || 0);
        const nearby = normalized.slice(Math.max(0, index - 16000), Math.min(normalized.length, index + 16000));
        if (!/music_info|music_asset|original_sound|audio_asset|audio_cluster|track/i.test(nearby)) continue;
        try {
          found.push({ url: new URL(normalize(match[1])).toString(), priority: /fast_start/i.test(match[0]) ? 110 : 105, path: 'page-embedded.progressive_download_url', distance: anchor >= 0 ? Math.abs(index - anchor) : index, startTimeMs: Number(nearby.match(/"audio_asset_start_time_in_ms"\s*:\s*(\d+)/i)?.[1] || 0), durationMs: Number(nearby.match(/"duration_in_ms"\s*:\s*(\d+)/i)?.[1] || 0) || null, ext: 'm4a' });
        } catch {}
      }
      if (found.length) {
        found.sort((a, b) => b.priority - a.priority || a.distance - b.distance);
        return { ...found[0], source: 'page-embedded' };
      }
      failures.push('page:no-audio-fields');
    } catch (error) {
      failures.push(`page:${error?.message || error}`);
    }
  }
  return null;
}

function toAudioItem(candidate, canonical, code) {
  console.info('[instagram-audio] resolved Instagram Reel sound:', JSON.stringify({
    code,
    source: candidate.source,
    mediaId: candidate.mediaId || null,
    host: new URL(candidate.url).hostname,
    path: candidate.path || null,
    startTimeMs: candidate.startTimeMs || 0,
    durationMs: candidate.durationMs || null,
    ext: candidate.ext || 'm4a',
  }));
  return {
    url: candidate.url,
    ext: candidate.ext || 'm4a',
    quality: 'Instagram sound',
    source: `instagram-${candidate.source}`,
    startTimeMs: candidate.startTimeMs || 0,
    durationMs: candidate.durationMs || null,
    headers: audioHeaders(canonical),
  };
}

export async function resolveInstagramAudio(rawUrl) {
  const canonical = canonicalUrl(rawUrl);
  const code = shortcode(canonical);
  const failures = [];
  if (!code) {
    const error = new Error('Instagram shortcode is missing.');
    error.code = 'INSTAGRAM_AUDIO_NOT_FOUND';
    throw error;
  }

  const embed = await embedCaptionedAudio(code, failures);
  if (embed) return toAudioItem(embed, canonical, code);

  const playback = await graphQlPlaybackAudio(code, failures);
  if (playback) return toAudioItem(playback, canonical, code);

  const mobile = await anonymousMobileMediaInfo(code, failures);
  if (mobile) return toAudioItem(mobile, canonical, code);

  const page = await pageFallback(canonical, code, failures);
  if (page) return toAudioItem(page, canonical, code);

  const error = new Error(`Instagram Reel sound was not found (${failures.join('; ')})`);
  error.code = 'INSTAGRAM_AUDIO_NOT_FOUND';
  throw error;
}
