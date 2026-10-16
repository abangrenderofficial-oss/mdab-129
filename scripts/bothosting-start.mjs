// Bot Hosting-only entry point. Does not change MediaX's Railway main/server.js.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const args=new Set(process.argv.slice(2));
const configCheck=args.has('--config-check');
const checkOnly=args.has('--check')||configCheck;
const failures=[];
const fail=msg=>{failures.push(msg);console.error('[BOTHOSTING] FAIL: '+msg)};
const ok=msg=>console.log('[BOTHOSTING] OK: '+msg);
const env=key=>String(process.env[key]||'').trim();
const required=[
  'TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','BOT_OWNER_ID','SETUP_SECRET',
  'PUBLIC_BASE_URL','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','GITHUB_ACTIONS_TOKEN',
  'BAYARCASH_API_SECRET_KEY','BAYARCASH_API_TOKEN','BAYARCASH_PORTAL_KEY',
];
function validateConfig(){
  for(const key of required)if(!env(key))fail('Missing required ENV: '+key);
  let url;
  try{url=new URL(env('PUBLIC_BASE_URL'))}catch{fail('PUBLIC_BASE_URL must be an HTTPS origin')}
  if(url&&(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password))
    fail('PUBLIC_BASE_URL must be a clean public HTTPS origin');
  if(!/^\d+$/.test(env('BOT_OWNER_ID')))fail('BOT_OWNER_ID must be numeric');
  if(!/^[A-Za-z0-9_-]{1,256}$/.test(env('TELEGRAM_WEBHOOK_SECRET')))
    fail('Invalid TELEGRAM_WEBHOOK_SECRET format');
  if(env('BAYARCASH_SANDBOX').toLowerCase()==='true')
    ok('Bayarcash sandbox enabled; production cutover is not enabled');
  if(env('PAYPING_SHARED_CONFIG_ENABLED').toLowerCase()!=='true')
    fail('PAYPING_SHARED_CONFIG_ENABLED=true required for MediaX policy sync');
  if(!Number.isInteger(Number(env('PORT')||3000))||Number(env('PORT')||3000)<1||Number(env('PORT')||3000)>65535)
    fail('PORT must be a valid TCP port');
  // Actual Telegram/Bayarcash/Turso credentials are never printed or contacted by preflight.
}
function commandOk(binary,args=['-version']){
  try{return !!String(execFileSync(binary,args,{encoding:'utf8',timeout:16000,stdio:['ignore','pipe','pipe']})).trim()}
  catch{return false}
}
function validateRuntime(){
  if(process.platform!=='linux'||process.arch!=='x64')fail('Prepared Bot Hosting profile targets Linux x64');
  if(Number(process.versions.node.split('.')[0])<22)fail('Requires Node.js 22+');
  let ffmpeg,ffprobe;
  try{ffmpeg=require('ffmpeg-static')}catch{fail('ffmpeg-static npm dependency unavailable')}
  try{ffprobe=require('ffprobe-static')?.path}catch{fail('ffprobe-static npm dependency unavailable')}
  if(!ffmpeg||!existsSync(ffmpeg)||!commandOk(ffmpeg))fail('FFmpeg executable unavailable');
  if(!ffprobe||!existsSync(ffprobe)||!commandOk(ffprobe))fail('FFprobe executable unavailable');
  if(ffmpeg&&ffprobe&&existsSync(ffmpeg)&&existsSync(ffprobe)){
    // Some media handlers call ffprobe from PATH. Reuse the actual packaged binaries.
    process.env.PATH=[dirname(ffmpeg),dirname(ffprobe),process.env.PATH||''].join(':');
    process.env.FFMPEG_PATH=ffmpeg;
    process.env.FFPROBE_PATH=ffprobe;
    ok('FFmpeg/FFprobe executable');
  }
  const ytdlp=join(root,'bin','yt-dlp-real');
  if(!existsSync(ytdlp)||!commandOk(ytdlp,['--version']))
    fail('yt-dlp binary absent: npm postinstall must finish successfully');
  else ok('yt-dlp executable');
}
function finish(){
  if(failures.length){console.error('[BOTHOSTING] Preflight failed. Telegram webhook was NOT changed.');process.exit(2)}
  ok('Preflight passed; no Telegram webhook has been modified');
}
validateConfig();
if(!configCheck)validateRuntime();
finish();
if(checkOnly)process.exit(0);

if(env('MEDIAX_BOTHOSTING_ACTIVE').toLowerCase()!=='true'){
  console.error('[BOTHOSTING] MEDIAX_BOTHOSTING_ACTIVE=true required. Stop Railway background jobs before activating this worker.');
  process.exit(2);
}
if(env('MEDIAX_BOTHOSTING_AUTO_WEBHOOK').toLowerCase()==='true'&&
   env('MEDIAX_BOTHOSTING_CUTOVER_APPROVED')!=='true'){
  console.error('[BOTHOSTING] Refusing webhook switch without MEDIAX_BOTHOSTING_CUTOVER_APPROVED=true');
  process.exit(2);
}
process.chdir(root);
console.log('[BOTHOSTING] Starting MediaX with existing production handlers; Railway main unchanged.');
await import('../server.js');
if(env('MEDIAX_BOTHOSTING_AUTO_WEBHOOK').toLowerCase()==='true'){
  // Start listening before switching Telegram's single active webhook.
  const health='http://127.0.0.1:'+(env('PORT')||'3000')+'/api/health';
  let ready=false;
  for(let n=0;n<15;n++){
    try{const r=await fetch(health,{signal:AbortSignal.timeout(2000)});if(r.ok&&(await r.json()).ok===true){ready=true;break}}catch{}
    await new Promise(r=>setTimeout(r,1000));
  }
  if(!ready){console.error('[BOTHOSTING] Health not ready. Telegram webhook unchanged.');process.exit(2)}
  await import('./bothosting-webhook.mjs');
}
