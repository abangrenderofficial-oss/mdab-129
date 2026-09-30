import { createHmac } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);
const url = String(process.env.INSTAGRAM_STORY_SMOKE_URL || '').trim();
const HMAC_KEY = Buffer.from('df73cf7be343f9701ce0f2ae809f9bd752e82fbb7017f463141664465b8ce8e0', 'hex');
const EMBEDDED_TS = '1770970183770';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function sign(target) {
  const ts = Date.now().toString();
  const sig = createHmac('sha256', HMAC_KEY).update(`${target}${ts}`).digest('hex');
  return new URLSearchParams({ sf_url: target, ts, _ts: EMBEDDED_TS, _tsc: '0', _sv: '2', _s: sig });
}

function looksUrl(v) { return typeof v === 'string' && /^https?:\/\//i.test(v); }
function classify(obj, key, value) {
  const hint = String(obj?.type ?? obj?.ext ?? obj?.mime_type ?? obj?.mimeType ?? obj?.kind ?? key ?? '').toLowerCase();
  const lower = String(value).toLowerCase();
  if (/audio|mp3|m4a|aac|ogg/.test(hint) || /\.(?:mp3|m4a|aac|ogg)(?:\?|$)/i.test(lower)) return 'audio';
  if (/video|mp4|quicktime/.test(hint) || /\.mp4(?:\?|$)/i.test(lower) || /cdninstagram|video/.test(lower)) return 'video';
  return 'unknown';
}
function collect(node, out = [], depth = 0) {
  if (node == null || depth > 9) return out;
  if (Array.isArray(node)) { node.forEach((x) => collect(x, out, depth + 1)); return out; }
  if (typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if (looksUrl(value)) out.push({ key, kind: classify(node, key, value), url: value, type: node?.type ?? null, ext: node?.ext ?? null, width: node?.width ?? null, height: node?.height ?? null, quality: node?.quality ?? node?.label ?? node?.name ?? null });
    collect(value, out, depth + 1);
  }
  return out;
}

async function mediaProbe(candidate) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ig-story-api-'));
  const file = path.join(dir, 'media.bin');
  try {
    const r = await fetch(candidate.url, { redirect: 'follow', headers: { 'User-Agent': UA, Referer: 'https://sssinstagram.com/en1' }, signal: AbortSignal.timeout(25000) });
    if (!r.ok || !r.body) throw new Error(`media-http-${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(file));
    let stderr = '';
    try { await execFileAsync(ffmpegPath, ['-hide_banner','-i',file], { timeout: 12000, maxBuffer: 8*1024*1024 }); } catch (e) { stderr = String(e?.stderr || e?.message || ''); }
    const video = stderr.match(/Video:[^\n]+/i)?.[0] || '';
    const audio = stderr.match(/Audio:[^\n]+/i)?.[0] || '';
    return { hasVideo: Boolean(video), hasAudio: Boolean(audio), video, audio };
  } finally { await rm(dir, {recursive:true, force:true}).catch(()=>{}); }
}

async function main() {
  if (!/instagram\.com\/stories\/[^/]+\/\d+/i.test(url)) return console.log('INSTAGRAM_STORY_SSS_API_SKIPPED');
  const started = Date.now();
  const response = await fetch('https://sssinstagram.com/api/convert', {
    method: 'POST',
    headers: {
      Accept: '*/*',
      Origin: 'https://sssinstagram.com',
      Referer: 'https://sssinstagram.com/en1',
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: sign(url).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  console.log('INSTAGRAM_STORY_SSS_API_RESPONSE', JSON.stringify({status:response.status, ms:Date.now()-started, bytes:text.length, prefix:text.slice(0,220).replace(/https?:\/\/[^"' ]+/g,'<url>')}));
  if (!response.ok) throw new Error(`sss-api-http-${response.status}`);
  const data = JSON.parse(text);
  const seen = new Set();
  const candidates = collect(data).filter((x)=>{ if(seen.has(x.url)) return false; seen.add(x.url); return true; });
  console.log('INSTAGRAM_STORY_SSS_API_CANDIDATES', JSON.stringify(candidates.slice(0,30).map((x)=>({key:x.key,kind:x.kind,type:x.type,ext:x.ext,width:x.width,height:x.height,quality:x.quality,host:new URL(x.url).hostname}))));
  const videos = candidates.filter((x)=>x.kind==='video');
  if (!videos.length) throw new Error('sss-api-no-video');
  let playable = null;
  for (const candidate of videos.slice(0,5)) {
    try {
      const p = await mediaProbe(candidate);
      console.log('INSTAGRAM_STORY_SSS_API_MEDIA_PROBE', JSON.stringify({host:new URL(candidate.url).hostname,hasVideo:p.hasVideo,hasAudio:p.hasAudio,video:p.video.slice(0,220),audio:p.audio.slice(0,220)}));
      if (p.hasVideo) { playable = {candidate,p}; break; }
    } catch(e) { console.warn('INSTAGRAM_STORY_SSS_API_MEDIA_ERROR', e?.message || e); }
  }
  if (!playable) throw new Error('sss-api-no-playable-video');
  console.log('INSTAGRAM_STORY_SSS_API_PASSED', JSON.stringify({ok:true,ms:Date.now()-started,hasAudio:playable.p.hasAudio}));
}

main().catch((error)=>{ console.error('INSTAGRAM_STORY_SSS_API_FAILED', error?.stack || error?.message || error); process.exit(1); });
