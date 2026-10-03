import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}

// yt-dlp is a lightweight resolver/fallback used by both Railway and Vercel.
// Heavy media encoding/transcoding remains isolated from this install step.
run(process.execPath, ['scripts/install-ytdlp.mjs']);
run('npm', ['run', 'check']);
