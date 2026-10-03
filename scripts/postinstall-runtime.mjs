import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}

const isVercel = String(process.env.VERCEL || '').toLowerCase() === '1';

if (!isVercel) {
  run(process.execPath, ['scripts/install-ytdlp.mjs']);
} else {
  console.log('[postinstall] Vercel detected: skipping local yt-dlp binary install; heavy media stays on GitHub Actions.');
}

run('npm', ['run', 'check']);
