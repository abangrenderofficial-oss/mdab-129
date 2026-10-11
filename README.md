# MediaX Downloader

Portable new-server setup: [DEPLOY-NEW-SERVER.md](./DEPLOY-NEW-SERVER.md)

This project uses Docker / Node.js 22 with FFmpeg, FFprobe, yt-dlp, the existing GitHub Actions heavy-media worker, Turso and Bayarcash. The new-server package is prepared on the `prepare-portable-deploy` branch to avoid extra production deployments.

Run `npm run preflight:build` and `npm run test:media-quality` to verify runtime media support. Never commit `.env` or payment/bot tokens.
