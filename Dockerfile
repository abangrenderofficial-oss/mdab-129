# MediaX portable production image. No media codec or quality-setting overrides.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# package.json postinstall installs yt-dlp + validates existing feature boundaries.
# This repository currently has no committed package-lock.json, so use npm install, NOT npm ci.
RUN npm install --omit=dev --no-audit --no-fund
RUN node scripts/deploy-preflight.mjs --build \
    && node scripts/media-aspect-audio-smoke.mjs

RUN chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["node", "scripts/container-healthcheck.mjs"]

CMD ["npm", "start"]
