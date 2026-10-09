// One-shot production Status HQ path test on Render standby.
// Resolves a real public video, downloads it, encodes with the exact bot path,
// validates output, and cleans /tmp. Never touches Telegram, Bayarcash or Turso.
import { resolveMedia, chooseBestVideo } from '../src/bot/media-resolver.js';
import { prepareWhatsAppStatusHQ } from '../src/status-hq.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
const execFileAsync=promisify(execFile);
const sample='https://vt.tiktok.com/ZSqqYxc13/';
const started=Date.now();
const log=(name,obj)=>console.log(name,JSON.stringify(obj));
let output;
try {
  const media=await resolveMedia('tiktok',sample);
  const video=chooseBestVideo(media?.videos||[]);
  if (!video?.url) throw Object.assign(new Error('TikTok test video could not be resolved'),{code:'SOURCE_UNAVAILABLE'});
  log('MEDIAX_RENDER_HQ_SOURCE',{ok:true,platform:'tiktok',videos:media?.videos?.length||0,hasAudioMetadata:video?.hasAudio===true});
  const audio=(media?.audios||[]).find(x=>x?.url)||null;
  output=await prepareWhatsAppStatusHQ({sourceUrl:media?.canonicalUrl||sample,platform:'tiktok',video,audio});
  if (!output?.filePath || !(output.size>0)) throw new Error('HQ returned no output file');
  const inspected=await execFileAsync(ffmpegPath,['-hide_banner','-i',output.filePath],{timeout:15000,maxBuffer:1024*1024})
    .catch(e=>({stderr:String(e.stderr||e.message||'')}));
  const info=String(inspected.stderr||'');
  const videoLine=info.match(/Video:[^\n]+/i)?.[0]||'';
  const audioLine=info.match(/Audio:[^\n]+/i)?.[0]||'';
  const inputHasAudio=Boolean(output.source?.hasAudio);
  const outputHasAudio=Boolean(output.profile?.hasAudio)&&Boolean(audioLine);
  const hevc=/hevc/i.test(videoLine);
  const underTelegramLimit=output.size < 50*1024*1024;
  const ok=hevc && underTelegramLimit && (!inputHasAudio || outputHasAudio);
  log('MEDIAX_RENDER_HQ_E2E',{
    ok,platform:'tiktok',fileMb:Math.round(output.size/1048576*100)/100,
    inputHasAudio,outputHasAudio,hevc,
    codec:String(output.profile?.codec||''),
    attempt:output.attempt,
    underTelegramLimit,
    elapsedSeconds:Math.round((Date.now()-started)/1000),
  });
  if(!ok) process.exitCode=1;
} catch(e) {
  const name=String(e?.code||e?.name||'error').slice(0,60);
  const msg=String(e?.message||'HQ test failed')
    .replace(/https?:\/\/[^\s"'<>]+/gi,'[url-redacted]')
    .slice(0,220);
  log('MEDIAX_RENDER_HQ_E2E',{ok:false,reason:name,detail:msg,elapsedSeconds:Math.round((Date.now()-started)/1000)});
  process.exitCode=1;
} finally {
  try {await output?.cleanup?.();} catch{}
}
