// Short-lived, single-purpose source stream for the isolated oversize TikTok
// worker. No changes to MediaX video codec, FPS or compression preset.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const STREAM_PATH = '/api/oversize-tiktok-source';
const TICKET_DIR = path.join(tmpdir(), 'mediax-oversize-source-tickets');
const TTL_MS = 20 * 60_000;
const MAX_SOURCE_BYTES = 500 * 1024 * 1024;

// File-backed tickets allow the bot's worker-dispatch process and persistent
// webhook server to share a short-lived token, including across Node restarts.
// Random ticket filenames and private file permissions prevent enumeration.
function ticketFile(token) {
  return /^[a-f0-9]{48}$/.test(String(token || ''))
    ? path.join(TICKET_DIR, `${token}.json`) : '';
}

function readTicket(token) {
  const file = ticketFile(token);
  if (!file) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function writeTicket(token, ticket, exclusive = false) {
  mkdirSync(TICKET_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(ticketFile(token), JSON.stringify(ticket), {
    encoding: 'utf8', mode: 0o600, flag: exclusive ? 'wx' : 'w',
  });
}

function validTikTokLink(raw) {
  try {
    const u = new URL(String(raw || ''));
    return u.protocol === 'https:' &&
      (u.hostname === 'tiktok.com' || u.hostname.endsWith('.tiktok.com'));
  } catch {
    return false;
  }
}

export function createOversizeTikTokSourceTicket(sourceUrl) {
  if (!validTikTokLink(sourceUrl)) throw new Error('Source ticket requires HTTPS TikTok URL.');
  const token = randomBytes(24).toString('hex');
  writeTicket(token, { sourceUrl: String(sourceUrl), expires: Date.now() + TTL_MS, attempts: 0 }, true);
  return token;
}

export function revokeOversizeTikTokSourceTicket(token) {
  const file = ticketFile(token);
  if (!file) return;
  try { unlinkSync(file); } catch {}
}

export function oversizeSourcePath() {
  return STREAM_PATH;
}

export function serveOversizeTikTokSource(req, res, url) {
  const token = String(url?.searchParams?.get('ticket') || '');
  const ticket = readTicket(token);
  if (!ticket || ticket.expires < Date.now() || ticket.attempts >= 2 ||
      !validTikTokLink(ticket.sourceUrl)) {
    revokeOversizeTikTokSourceTicket(token);
    return res.status(404).json({ ok: false, error: 'source_ticket_invalid_or_expired' });
  }
  ticket.attempts += 1;
  writeTicket(token, ticket);
  const binary = path.join(process.cwd(), 'bin', 'yt-dlp');
  const args = [
    '--no-playlist', '--no-warnings', '--no-check-certificates',
    '--js-runtimes', `node:${process.execPath}`,
    '--remote-components', 'ejs:github',
    '--force-ipv4',
    '--format', 'best[ext=mp4]/best',
    '--no-progress', '--no-part', '--output', '-',
    '--', ticket.sourceUrl,
  ];
  const child = spawn(binary, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let total = 0;
  let diagnostics = '';
  let closed = false;
  let finished = false;
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 4 * 60_000);
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Content-Disposition': 'attachment; filename="mediax-source.mp4"',
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
  });

  child.stderr.on('data', data => {
    diagnostics = (diagnostics + data.toString()).slice(-500);
  });
  child.stdout.on('data', chunk => {
    total += chunk.length;
    if (total > MAX_SOURCE_BYTES) {
      child.kill('SIGKILL');
      res.destroy(new Error('Oversized source exceeds 500 MiB'));
    }
  });
  child.stdout.pipe(res);

  res.on('close', () => {
    closed = true;
    if (!finished) child.kill('SIGKILL');
  });
  child.on('error', error => {
    clearTimeout(watchdog);
    console.warn('[oversize-source] subprocess failed:', error?.message);
    if (!res.destroyed) res.destroy();
  });
  child.on('exit', (code, signal) => {
    finished = true;
    clearTimeout(watchdog);
    if (code !== 0) {
      console.warn('[oversize-source] download failed:', code, signal, diagnostics.slice(-250));
      if (!res.destroyed) res.destroy();
    } else {
      console.info('[oversize-source] streamed source', { bytes: total, closed });
    }
  });
}
