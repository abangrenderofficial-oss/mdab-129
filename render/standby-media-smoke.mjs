// Isolated Render standby diagnostics. No Telegram sends, webhook changes,
// Turso writes, payment intents or external callbacks.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveMedia } from '../src/bot/media-resolver.js';
import ffmpegPath from 'ffmpeg-static';
const execFileAsync = promisify(execFile);
const started = Date.now();
const cases = [
  ['tiktok', 'https://vt.tiktok.com/ZSqqYxc13/'],
  ['instagram', 'https://www.instagram.com/reel/DdVLsscjj2o/'],
  ['threads', 'https://www.threads.com/share/BALVYg5Lmq/'],
  ['youtube', 'https://youtu.be/RKdxQwnRRqw'],
];
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
    const result={platform,ok:false,elapsedMs:Date.now()-time,reason:String(err?.code||err?.message||'unknown').slice(0,220)};
    results.push(result);log('MEDIAX_RENDER_RESOLVER',result);
  }
}
log('MEDIAX_RENDER_MEDIA_AUDIT',{
  total:results.length,pass:results.filter(r=>r.ok).length,
  failed:results.filter(r=>!r.ok).map(r=>r.platform),
  binariesPass:binaries.filter(r=>r.ok).length,
  durationMs:Date.now()-started,
  note:'standby diagnostics only; no Telegram sending or HQ encoding',
});
process.exit(0);
