import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildOnly = process.argv.includes('--build');
const configOnly = process.argv.includes('--config');
const preview = /^(true|1|yes)$/i.test(String(process.env.MEDIAX_PREVIEW_MODE || ''));
const failures = [];
const pass = (message) => console.log('[mediax-preflight] OK:', message);
const fail = (message) => { failures.push(message); console.error('[mediax-preflight] FAIL:', message); };

function commandOutput(executable, args = []) {
  try {
    return String(execFileSync(executable, args, {
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    }));
  } catch {
    return '';
  }
}

function checkRuntime() {
  if (Number(process.versions.node.split('.')[0]) < 22) fail('Node.js 22+ is required');
  else pass('Node.js >=22');

  if (!ffmpegPath || !existsSync(ffmpegPath)) {
    fail('ffmpeg-static executable is missing');
  } else {
    const ffmpegVersion = commandOutput(ffmpegPath, ['-version']);
    if (!ffmpegVersion.includes('ffmpeg version')) fail('ffmpeg-static cannot run on this server architecture');
    else pass('ffmpeg-static executable works');

    const encoders = commandOutput(ffmpegPath, ['-hide_banner', '-encoders']);
    for (const codec of ['libx264', 'libx265', 'aac']) {
      if (!new RegExp('\\b' + codec + '\\b').test(encoders)) fail('ffmpeg-static lacks encoder: ' + codec);
      else pass('encoder available: ' + codec);
    }
  }

  if (!commandOutput('ffprobe', ['-version']).includes('ffprobe version')) fail('system ffprobe is missing');
  else pass('ffprobe works');

  for (const name of ['yt-dlp', 'yt-dlp-real']) {
    const bin = path.join(root, 'bin', name);
    if (!existsSync(bin) || !commandOutput(bin, ['--version']).trim()) fail(name + ' is missing or not executable');
    else pass(name + ' works');
  }
}

function checkConfig() {
  const required = [
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'SETUP_SECRET',
    'PUBLIC_BASE_URL', 'BOT_OWNER_ID', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN',
    'GITHUB_ACTIONS_TOKEN', 'BAYARCASH_API_SECRET_KEY',
    'BAYARCASH_API_TOKEN', 'BAYARCASH_PORTAL_KEY',
  ];
  for (const name of required) {
    const value = String(process.env[name] || '').trim();
    if (!value || /^(your_|replace_|changeme|todo|xxx)/i.test(value)) fail('required ENV missing: ' + name);
  }

  let url;
  try { url = new URL(String(process.env.PUBLIC_BASE_URL || '')); } catch {}
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    fail('PUBLIC_BASE_URL must be a public HTTPS URL with no query, fragment, or credentials');
  } else pass('PUBLIC_BASE_URL is HTTPS');

  if (!/^\d+$/.test(String(process.env.BOT_OWNER_ID || ''))) fail('BOT_OWNER_ID must be numeric');
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(String(process.env.TELEGRAM_WEBHOOK_SECRET || ''))) {
    fail('TELEGRAM_WEBHOOK_SECRET must contain only A-Z, a-z, 0-9, _ or - (1-256 chars)');
  }
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('PORT must be a valid TCP port');
  if (!failures.length) pass('required runtime configuration present (credentials not tested against providers)');
}

if (preview) {
  for (const key of ['TELEGRAM_BOT_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'GITHUB_ACTIONS_TOKEN',
    'BAYARCASH_API_TOKEN', 'BAYARCASH_API_SECRET_KEY']) {
    if (String(process.env[key] || '').trim()) fail('preview mode must not use a live credential: ' + key);
  }
  pass('preview mode: external configuration and binary checks skipped; outbound writes blocked in server');
} else {
  if (!configOnly) checkRuntime();
  if (!buildOnly) checkConfig();
}

if (failures.length) {
  console.error('[mediax-preflight] Aborting: ' + failures.length + ' requirement(s) failed.');
  process.exit(1);
}
console.log('[mediax-preflight] PASS');
