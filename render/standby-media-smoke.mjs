// Isolated Render standby diagnostics. No Telegram sends, webhook changes,
// Turso writes, payment intents or external callbacks.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';
import { resolveMedia } from '../src/bot/media-resolver.js';
import ffmpegPath from 'ffmpeg-static';
const execFileAsync = promisify(execFile);
const started = Date.now();
const cases = [
  ['instagram', 'https://www.instagram.com/reel/DdVLsscjj2o/?stkn=MXV3a2hncmE3cWZheQ=='],
  ['youtube', 'https://youtu.be/RKdxQwnRRqw?si=GJX9HDe4OBsxwBYQ'],
];
function safeError(error) {
  return String(error?.message || error || 'unknown')
    .replace(/https?:\/\/[^\s"']+/g, '[url-redacted]')
    .replace(/(?:token|secret|apikey|password|authorization)[=:]\S+/gi, '[secret-redacted]')
    .replace(/\s+/g, ' ').slice(0, 440);
}
async function probeHttp(label, url) {
  try {
    const r=await fetch(url,{signal:AbortSignal.timeout(9000),headers:{'user-agent':'Mozilla/5.0','accept':'application/json,text/html'}});
    log('MEDIAX_RENDER_UPSTREAM',{label,status:r.status,ok:r.ok,finalHost:new URL(r.url).hostname});
    await r.body?.cancel().catch(()=>{});
  } catch(e) {
    log('MEDIAX_RENDER_UPSTREAM',{label,ok:false,reason:String(e?.name||'fetch_failed').slice(0,90)});
  }
}
await probeHttp('instagram_page','https://www.instagram.com/reel/DdVLsscjj2o/');
await probeHttp('weirddl_info','https://weirddl.sbs/api/info?url=https%3A%2F%2Fyoutu.be%2FRKdxQwnRRqw');

function log(name, data) { console.log(name, JSON.stringify(data)); }
async function binaryProbe(label, binary, args, ms=12000) {
  try {
    const out = await execFileAsync(binary, args, {timeout:ms, maxBuffer: 100_000});
    return {ok:true, label, firstLine: String(out.stdout || out.stderr || '').split('\n')[0].slice(0,90)};
  } catch (e) { return {ok:false,label,error:String(e.code || e.message).slice(0,150)}; }
}
const binaries = [];
binaries.push(await binaryProbe('ffmpeg',ffmpegPath,['-version']));
binaries.push(await binaryProbe('yt-dlp','./bin/yt-dlp',['--version']));
log('MEDIAX_RENDER_BINARIES', {results:binaries});
// Real one-second H.264/AAC encode. No user media or Telegram involved.
const videoPath='/tmp/mediax-standby-encode-'+process.pid+'.mp4';
try {
  await execFileAsync(ffmpegPath,[
    '-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=320x180:r=15',
    '-f','lavfi','-i','sine=frequency=440:sample_rate=44100',
    '-t','1','-c:v','libx264','-preset','ultrafast','-c:a','aac',
    '-b:a','96k','-movflags','+faststart','-y',videoPath
  ],{timeout:20000,maxBuffer:200000});
  log('MEDIAX_RENDER_ENCODE',{ok:true,videoCodec:'h264',audioCodec:'aac',durationSeconds:1});
} catch(err) {
  log('MEDIAX_RENDER_ENCODE',{ok:false,reason:String(err.code||err.message).slice(0,180)});
} finally { await unlink(videoPath).catch(()=>{}); }

const results=[];
for(const [platform,url] of cases) {
  const time=Date.now();
  try {
    // This is the same resolver used by MediaX's Telegram media path.
    // Read-only remote request; output is not downloaded/uploaded.
    const media=await Promise.race([
      resolveMedia(platform,url),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('resolver_timeout')),45000)),
    ]);
    const counts={videos:media?.videos?.length||0,images:media?.images?.length||0,audios:media?.audios?.length||0};
    const ok=Object.values(counts).some(x=>x>0);
    const result={platform,ok,elapsedMs:Date.now()-time,counts,...(!ok?{reason:'no_media_resolved'}:{})};
    results.push(result);log('MEDIAX_RENDER_RESOLVER',result);
  } catch(err) {
    const result={platform,ok:false,elapsedMs:Date.now()-time,reason:String(err?.code||'unknown').slice(0,100),detail:safeError(err)};
    results.push(result);log('MEDIAX_RENDER_RESOLVER',result);
  }
}
log('MEDIAX_RENDER_MEDIA_AUDIT',{
  total:results.length,pass:results.filter(r=>r.ok).length,
  failed:results.filter(r=>!r.ok).map(r=>r.platform),
  binariesPass:binaries.filter(r=>r.ok).length,
  durationMs:Date.now()-started,
  note:'standby diagnostics only; 1-second synthetic H264/AAC encode, no Telegram sending or user video conversion',
});
process.exit(0);
