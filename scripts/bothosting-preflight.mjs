// No network, database write, Telegram action, webhook registration, or secret values.
import {spawnSync} from 'node:child_process';
import {accessSync, constants, existsSync} from 'node:fs';
import process from 'node:process';
import ffmpegPath from 'ffmpeg-static';
const prod = process.argv.includes('--production');
let failed = false;
function check(name, ok, severity='required') {
  console.log(`[bothosting-preflight] ${ok ? 'OK' : severity === 'optional' ? 'OPTIONAL' : 'FAIL'}: ${name}`);
  if(!ok && severity === 'required') failed=true;
}
const major = Number(process.versions.node.split('.')[0]);
check('Node.js >= 22',major>=22);
check('Linux x64 binary-compatible runtime',process.platform==='linux' && process.arch==='x64');
const portValue = String(process.env.SERVER_PORT || process.env.PORT || '3000');
check('Valid public HTTP binding port',Number.isInteger(Number(portValue)) && Number(portValue)>0 && Number(portValue)<=65535);
check('yt-dlp installed at bin/yt-dlp',existsSync('bin/yt-dlp'));
let ffmpegExecutable=false;
try{accessSync(ffmpegPath,constants.X_OK);const run=spawnSync(ffmpegPath,['-version'],{timeout:5000,encoding:'utf8'}); ffmpegExecutable=run.status===0;}catch{}
check('Bundled ffmpeg-static executable',ffmpegExecutable);
const ytdlp=spawnSync('bin/yt-dlp',['--version'],{timeout:10000,encoding:'utf8'});
check('yt-dlp executable starts',ytdlp.status===0);
if (prod) {
  const required=['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','SETUP_SECRET','BOT_OWNER_ID','PUBLIC_BASE_URL','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','GITHUB_ACTIONS_TOKEN','BAYARCASH_API_SECRET_KEY','BAYARCASH_API_TOKEN','BAYARCASH_PORTAL_KEY'];
  for(const key of required)check('ENV '+key,Boolean(String(process.env[key]||'').trim()));
  const base=String(process.env.PUBLIC_BASE_URL||'').trim();
  let validHttps=false;
  try{ const parsed=new URL(base);validHttps=parsed.protocol==='https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname==='/';}catch{}
  check('PUBLIC_BASE_URL is HTTPS origin, without path',validHttps);
  if(process.env.PAYPING_SHARED_CONFIG_ENABLED==='true')console.log('[bothosting-preflight] PayPing shared access-control enabled; using existing Turso canonical policies');
}
console.log(failed?'[bothosting-preflight] FAILED':'[bothosting-preflight] PASSED');
if(failed)process.exitCode=1;
