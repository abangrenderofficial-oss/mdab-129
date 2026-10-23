// Isolated TikTok Photo Mode resolver used when TikWM is rate-limited or blocked.
// Reads TikTok's public embed metadata: imagePostInfo + musicInfos.
// No bot credentials, account cookies, headless browser or external paid APIs.
const TIKTOK_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

function isTikTokHost(host) {
  const name = String(host || '').toLowerCase();
  return name === 'tiktok.com' || name.endsWith('.tiktok.com');
}

function photoId(url) {
  try {
    const parsed = new URL(url);
    if (!isTikTokHost(parsed.hostname)) return '';
    return parsed.pathname.match(/\/photo\/(\d{10,25})(?:\/|$)/)?.[1] || '';
  } catch {
    return '';
  }
}

function httpsAsset(value) {
  const candidates = Array.isArray(value) ? value : [value];
  for (const item of candidates) {
    if (typeof item !== 'string') continue;
    try {
      const url = new URL(item);
      if (url.protocol === 'https:') return url.toString();
    } catch {}
  }
  return '';
}

function parseEmbeddedPhoto(html, requestedId) {
  const match = String(html || '').match(
    /<script\b[^>]*\bid=["']__FRONTITY_CONNECT_STATE__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;

  const state = JSON.parse(match[1]);
  const data = state?.source?.data;
  if (!data || typeof data !== 'object') return null;
  const entry = Object.values(data).find((item) =>
    item?.videoData?.itemInfos
    && String(item.videoData.itemInfos.id || '') === requestedId,
  );
  const detail = entry?.videoData;
  if (!detail) return null;

  const imageList = detail.imagePostInfo?.displayImages;
  if (!Array.isArray(imageList) || !imageList.length) return null;
  const images = imageList
    .map((image) => ({
      url: httpsAsset(image?.urlList || image?.imageURL || image?.url),
    }))
    .filter((image) => image.url);
  if (!images.length) return null;

  const music = detail.musicInfos || {};
  const audioUrl = httpsAsset(music.playUrl || music.play_url || music.play);
  if (!audioUrl) return null; // Never offer a Video+Audio choice without sound.

  const title = String(detail.itemInfos?.text || '').trim();
  const musicTitle = String(music.musicName || 'TikTok sound').trim() || 'TikTok sound';
  const performer = String(music.authorName || '').trim();
  const duration = Number(detail.itemInfos?.video?.videoMeta?.duration || 0);

  return {
    platform: 'TikTok',
    title,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    images,
    videos: [],
    audios: [{ url: audioUrl, quality: 'audio' }],
    audio: { url: audioUrl, title: musicTitle, performer },
    canonicalUrl: '',
    source: 'tiktok-public-embed',
  };
}


/**
 * TikTok's Photo URL is sometimes an app-gated shell (HTTP 200 with no item
 * media) while the SAME public post has full imagePost + music metadata on
 * /@creator/video/POST_ID. Tested against the actual Bot Hosting egress.
 * Never uses another user's account, cookies or undocumented paid products.
 */
export function parseTikTokPagePhoto(html, requestedId) {
  const match = String(html || '').match(
    /<script\b[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;
  let state;
  try { state = JSON.parse(match[1]); } catch { return null; }
  const detail = state?.__DEFAULT_SCOPE__?.['webapp.video-detail'];
  if (Number(detail?.statusCode) !== 0) return null;
  const item = detail?.itemInfo?.itemStruct;
  if (!item || String(item.id || '') !== String(requestedId)) return null;

  const originals = item?.imagePost?.images;
  if (!Array.isArray(originals) || !originals.length) return null;
  // Never substitute the cover thumbnail for a slideshow. Keep all images
  // in original order and use the source CDN's largest available URL.
  const images = originals.map((image) => ({
    url: httpsAsset(image?.imageURL?.urlList || image?.imageURL || image?.urlList),
    width: Number(image?.imageWidth || image?.imageURL?.width || 0) || null,
    height: Number(image?.imageHeight || image?.imageURL?.height || 0) || null,
  }));
  if (images.some((image) => !image.url)) return null;

  const music = item?.music || {};
  const sound = httpsAsset(music.playUrl || music.play_url);
  if (!sound) return null; // Both output buttons require real soundtrack.
  const seconds = Number(music.duration || item?.video?.duration || 0);
  return {
    platform: 'TikTok',
    title: String(item.desc || item?.imagePost?.title || '').trim(),
    duration: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    images,
    videos: [],
    audios: [{ url: sound, quality: 'audio' }],
    audio: {
      url: sound,
      title: String(music.title || 'TikTok sound').trim() || 'TikTok sound',
      performer: String(music.authorName || '').trim(),
    },
    canonicalUrl: '',
    source: 'tiktok-original-video-page',
  };
}

async function resolvePublicVideoPagePhoto(canonical, requestedId, fetchImpl) {
  const url = new URL(canonical);
  if (!isTikTokHost(url.hostname) || !/^\/@[A-Za-z0-9._-]+\/photo\/\d{10,25}(?:\/|$)/.test(url.pathname)) return null;
  // Exact same author + post ID, no search or account lookup.
  const page = new URL(url.pathname.replace('/photo/', '/video/'), 'https://www.tiktok.com');
  const response = await fetchImpl(page, {
    redirect: 'follow',
    headers: {
      Accept: 'text/html',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return null;
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > 2_500_000) return null;
  const html = await response.text();
  if (html.length > 2_500_000) return null;
  return parseTikTokPagePhoto(html, requestedId);
}

/**
 * Resolve an accessible TikTok Photo Mode post with music.
 * Returns null for normal videos, unavailable/private posts or blocked embeds.
 * fetchImpl is injectable so unit tests don't require TikTok network access.
 */
export async function resolveTikTokEmbeddedPhoto(link, { fetchImpl = fetch } = {}) {
  let canonical = String(link || '').trim();
  if (!canonical) return null;

  let id = photoId(canonical);
  if (!id) {
    // Short links like vt.tiktok.com/XXX must be followed to learn whether
    // TikTok serves a /photo/ or /video/ post before fetching the embed.
    let input;
    try { input = new URL(canonical); } catch { return null; }
    if (!isTikTokHost(input.hostname)) return null;

    const response = await fetchImpl(canonical, {
      redirect: 'follow',
      headers: { 'User-Agent': TIKTOK_USER_AGENT },
      signal: AbortSignal.timeout(12000),
    });
    canonical = String(response.url || '');
    id = photoId(canonical);
    await response.body?.cancel?.().catch(() => {});
    if (!id) return null;
  }

  // This path works on cloud IPs even where /photo/ metadata and /embed/v2
  // are rate-limited. Prefer it over the older embed endpoint.
  try {
    const original = await resolvePublicVideoPagePhoto(canonical, id, fetchImpl);
    if (original?.images?.length && original?.audio?.url) {
      console.info('[tiktok-photo] original page resolved', { images: original.images.length, hasAudio: true });
      return { ...original, canonicalUrl: canonical };
    }
  } catch (error) {
    console.warn('[tiktok-photo] original page unavailable; trying embed:', error?.message);
  }

  const endpoint = `https://www.tiktok.com/embed/v2/${id}`;
  // Photo embeds sometimes transiently return HTTP 500 on cloud IPs.
  // Retry a bounded number of times; never modify Telegram state here.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, {
        headers: {
          Accept: 'text/html',
          'User-Agent': TIKTOK_USER_AGENT,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`TikTok embed returned HTTP ${response.status}`);
        }
        return null; // Protected/private or unavailable post.
      }
      const body = await response.text();
      if (body.length > 2_000_000) throw new Error('TikTok embed response too large');
      const item = parseEmbeddedPhoto(body, id);
      if (!item) return null;
      return { ...item, canonicalUrl: canonical };
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  return null;
}
