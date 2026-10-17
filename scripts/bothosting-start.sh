#!/bin/sh
# Install only when dependencies are missing; avoid network-dependent re-install on every restart.
# Bot-Hosting executes this from /home/container.
set -eu
if [ ! -d node_modules/ffmpeg-static ] || [ ! -d node_modules/@libsql/client ] || [ ! -x bin/yt-dlp ]; then
  echo '[mediax] Installing missing dependencies...'
  npm install --no-audit --no-fund
fi
node scripts/bothosting-quality-guard.mjs
node scripts/bothosting-preflight.mjs --production
exec node server.js
