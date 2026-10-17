#!/bin/sh
# Install only when dependencies are missing; avoid network-dependent re-install on every restart.
# Bot-Hosting executes this from /home/container.
set -eu
if [ ! -d node_modules/ffmpeg-static ] || [ ! -d node_modules/@libsql/client ] || [ ! -x bin/yt-dlp ]; then
  echo '[mediax] Installing missing dependencies...'
  npm install --no-audit --no-fund
fi
# npm 12 may block ffmpeg-static install scripts; install its binary explicitly if absent.
if [ ! -x node_modules/ffmpeg-static/ffmpeg ]; then
  echo '[mediax] Installing bundled ffmpeg-static binary...'
  node node_modules/ffmpeg-static/install.js
fi
node scripts/bothosting-quality-guard.mjs
# Allow a SAFE HTTP-only standby deployment before production secrets are supplied.
# Full secret validation is strictly required whenever Telegram/payment processing is enabled.
if [ "${MEDIAX_HOSTING_STANDBY:-false}" = "true" ]; then
  echo '[mediax] Safe standby requested: validating runtime only; payment and Telegram credentials remain required for production.'
  node scripts/bothosting-preflight.mjs
else
  node scripts/bothosting-preflight.mjs --production
fi
exec node server.js
