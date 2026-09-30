import chromiumPack from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';
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
const rawUrl = String(process.env.INSTAGRAM_STORY_SMOKE_URL || '').trim();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function canonicalStoryUrl(value) {
  const input = new URL(value);
  const match = input.pathname.match(/^\/stories\/([^/?#]+)\/(\d+)/i);
  if (!match?.[1] || !match?.[2]) throw new Error('instagram-story-url-invalid');
  return `https://www.instagram.com/stories/${match[1]}/${match[2]}/`;
}
function isUrl(v) { return typeof v === 'string' && /^https?:\/\//i.test(v); }
function classify(obj, key, value) {
  const hint = String(obj?.type ?? obj?.media_type ?? obj?.mime ?? obj?.mime_type ?? obj?.ext ?? obj?.kind ?? key ?? '').toLowerCase();
  const lower = String(value).toLowerCase();
  if (/audio|sound|music|mp3|m4a|aac|ogg/.test(hint) || /\.(?:mp3|m4a|aac|ogg)(?:\?|$)/i.test(lower)) return 'audio';
  if (/image|photo|jpg|jpeg|png|webp/.test(hint) || /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(lower)) return 'image';
  if (/video|mp4|quicktime/.test(hint) || /\.mp4(?:\?|$)/i.test(lower) || /media\.sssinstagram\.com\/get/i.test(lower)) return 'video-or-media';
  return 'unknown';
}
function collect(node, out = [], depth = 0, pathParts = []) {
  if (node == null || depth > 10) return out;
  if (Array.isArray(node)) { node.forEach((x,i)=>collect(x,out,depth+1,[...pathParts,String(i)])); return out; }
  if (typeof node !== 'object') return out;
  for (const [key,value] of Object.entries(node)) {
    if (isUrl(value)) out.push({path:[...pathParts,key].join('.'),kind:classify(node,key,value),url:value,type:node?.type??node?.media_type??null,ext:node?.ext??null,width:node?.width??null,height:node?.height??null});
    collect(value,out,depth+1,[...pathParts,key]);
  }
  return out;
}
function redactUrls(text='') { return String(text).replace(/https?:\/\/[^"'\\\s]+/g,(m)=>{try{return `<url:${new URL(m.replace(/\\u0026/g,'&').replace(/\\\//g,'/')).hostname}>`;}catch{return '<url>';}}); }
async function probeUrl(mediaUrl, headers={}) {
  const dir = await mkdtemp(path.join(tmpdir(),'ig-story-current-'));
  const file = path.join(dir,'media.bin');
  try {
    const response = await fetch(mediaUrl,{redirect:'follow',headers:{'User-Agent':UA,Referer:'https://sssinstagram.com/story-saver',...headers},signal:AbortSignal.timeout(25000)});
    if(!response.ok||!response.body) throw new Error(`media-http-${response.status}`);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(file));
    let stderr='';
    try{await execFileAsync(ffmpegPath,['-hide_banner','-i',file],{timeout:12000,maxBuffer:8*1024*1024});}catch(e){stderr=String(e?.stderr||e?.message||'');}
    const video=stderr.match(/Video:[^\n]+/i)?.[0]||'';
    const audio=stderr.match(/Audio:[^\n]+/i)?.[0]||'';
    return {hasVideo:Boolean(video),hasAudio:Boolean(audio),video,audio,contentType:response.headers.get('content-type')||''};
  } finally { await rm(dir,{recursive:true,force:true}).catch(()=>{}); }
}

async function main(){
  if(!/instagram\.com\/stories\/[^/]+\/\d+/i.test(rawUrl)) return console.log('INSTAGRAM_STORY_CURRENT_API_SKIPPED');
  const target=canonicalStoryUrl(rawUrl);
  const started=Date.now();
  const executablePath=await chromiumPack.executablePath();
  const browser=await playwrightChromium.launch({args:chromiumPack.args,executablePath,headless:true,timeout:12000});
  try{
    const context=await browser.newContext({userAgent:UA,viewport:{width:1280,height:900},locale:'en-US'});
    const page=await context.newPage();
    await page.goto('https://sssinstagram.com/story-saver',{waitUntil:'domcontentloaded',timeout:12000});
    const input=page.locator('#input, input[placeholder*="Paste" i]').first();
    await input.waitFor({timeout:8000});
    await input.fill(target);
    const storyPromise=page.waitForResponse((r)=>/api-wh\.sssinstagram\.com\/api\/v1\/instagram\/story/i.test(r.url())&&r.request().method()==='POST',{timeout:20000});
    const mediaPromise=page.waitForResponse((r)=>/media\.sssinstagram\.com\/get/i.test(r.url()),{timeout:20000}).catch(()=>null);
    await page.locator('button.form__submit, button:has-text("Download")').first().click({timeout:8000});
    const storyResponse=await storyPromise;
    const request=storyResponse.request();
    const text=await storyResponse.text();
    console.log('INSTAGRAM_STORY_CURRENT_API_RESPONSE',JSON.stringify({status:storyResponse.status(),ms:Date.now()-started,bytes:text.length,requestContentType:request.headers()['content-type']||null,requestPostBytes:(request.postData()||'').length,prefix:redactUrls(text.slice(0,1200))}));
    let data=null; try{data=JSON.parse(text);}catch{}
    if(!data) throw new Error('story-api-invalid-json');
    const seen=new Set();
    const candidates=collect(data).filter((x)=>{if(seen.has(x.url))return false;seen.add(x.url);return true;});
    console.log('INSTAGRAM_STORY_CURRENT_API_CANDIDATES',JSON.stringify(candidates.slice(0,40).map((x)=>({path:x.path,kind:x.kind,type:x.type,ext:x.ext,width:x.width,height:x.height,host:new URL(x.url).hostname}))));
    const mediaResponse=await mediaPromise;
    if(mediaResponse){
      const mediaReq=mediaResponse.request();
      console.log('INSTAGRAM_STORY_CURRENT_MEDIA_REQUEST',JSON.stringify({status:mediaResponse.status(),host:new URL(mediaResponse.url()).hostname,contentType:mediaResponse.headers()['content-type']||null,requestHeaders:Object.fromEntries(Object.entries(mediaReq.headers()).filter(([k])=>['referer','origin','user-agent'].includes(k.toLowerCase())))}));
      const probed=await probeUrl(mediaResponse.url(),Object.fromEntries(Object.entries(mediaReq.headers()).filter(([k])=>['referer','origin'].includes(k.toLowerCase())))).catch((e)=>({error:e?.message||String(e)}));
      console.log('INSTAGRAM_STORY_CURRENT_MEDIA_PROBE',JSON.stringify(probed));
    }
    for(const candidate of candidates.filter((x)=>x.kind==='video-or-media').slice(0,6)){
      const p=await probeUrl(candidate.url).catch((e)=>({error:e?.message||String(e)}));
      console.log('INSTAGRAM_STORY_CURRENT_CANDIDATE_PROBE',JSON.stringify({path:candidate.path,host:new URL(candidate.url).hostname,...p,video:p.video?.slice?.(0,220),audio:p.audio?.slice?.(0,220)}));
      if(p.hasVideo){
        console.log('INSTAGRAM_STORY_CURRENT_API_PASSED',JSON.stringify({ok:true,ms:Date.now()-started,hasAudio:p.hasAudio,path:candidate.path}));
        await context.close().catch(()=>{});
        return;
      }
    }
    throw new Error('story-api-no-playable-video-candidate');
  } finally { await browser.close().catch(()=>{}); }
}
main().catch((error)=>{console.error('INSTAGRAM_STORY_CURRENT_API_FAILED',error?.stack||error?.message||error);process.exit(1);});
