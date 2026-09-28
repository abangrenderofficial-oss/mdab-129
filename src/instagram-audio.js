const INSTAGRAM_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

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

function normalizeEmbeddedText(value = '') {
  return String(value)
    .replaceAll('\\\\u0026', '&')
    .replaceAll('\\u0026', '&')
    .replaceAll('&amp;', '&')
    .replaceAll('\\/', '/')
    .replaceAll('\\"', '"');
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
    const offsetMatch = nearby.match(/"audio_asset_start_time_in_ms"\s*:\s*(\d+)/i);
    const durationMatch = nearby.match(/"duration_in_ms"\s*:\s*(\d+)/i);
    candidates.push({
      url,
      index,
      distance: anchor >= 0 ? Math.abs(index - anchor) : index,
      startTimeMs: offsetMatch ? Number(offsetMatch[1]) : 0,
      durationMs: durationMatch ? Number(durationMatch[1]) : null,
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

async function fetchInstagramText(url) {
  const controller = new AbortController();
  const timeoutMs = Math.max(5000, Number(process.env.INSTAGRAM_AUDIO_METADATA_TIMEOUT_MS || 20000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': INSTAGRAM_BROWSER_UA,
        Referer: 'https://www.instagram.com/',
      },
    });
    if (!response.ok) throw new Error(`Instagram metadata HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveInstagramAudio(rawUrl) {
  const canonical = canonicalInstagramUrl(rawUrl);
  const code = reelCode(canonical);
  const endpoints = [canonical];
  try {
    const jsonUrl = new URL(canonical);
    jsonUrl.searchParams.set('__a', '1');
    jsonUrl.searchParams.set('__d', 'dis');
    endpoints.push(jsonUrl.toString());
  } catch {}

  const failures = [];
  for (const endpoint of endpoints) {
    try {
      const text = await fetchInstagramText(endpoint);
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
        headers: {
          Referer: canonical,
          'User-Agent': INSTAGRAM_BROWSER_UA,
          Accept: 'audio/mp4,audio/*;q=0.9,*/*;q=0.8',
        },
      };
    } catch (error) {
      failures.push(`${new URL(endpoint).pathname}:${error?.message || error}`);
    }
  }

  const error = new Error(`Instagram Reel audio metadata was not found (${failures.join('; ')})`);
  error.code = 'INSTAGRAM_AUDIO_NOT_FOUND';
  throw error;
}
