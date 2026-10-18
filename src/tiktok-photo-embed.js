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
