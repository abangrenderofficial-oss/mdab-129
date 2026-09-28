import { processStandardDownload } from '../src/features/downloader.js';

const url = String(process.env.INSTAGRAM_MUX_SMOKE_URL || '').trim();
const chatId = Number(process.env.BOT_OWNER_ID || 0);

async function main() {
  if (!url || !/instagram\.com\/(?:reel|reels|p)\//i.test(url)) {
    console.log('INSTAGRAM_TELEGRAM_E2E_SKIPPED no-url');
    return;
  }
  if (!Number.isFinite(chatId) || chatId <= 0) {
    console.log('INSTAGRAM_TELEGRAM_E2E_SKIPPED no-owner-chat');
    return;
  }

  const started = Date.now();
  const result = await processStandardDownload({
    chatId,
    url,
    platform: 'instagram',
    context: {
      baseUrl: String(process.env.PUBLIC_BASE_URL || '').trim(),
      mirrorGroupId: null,
      fence: null,
    },
    message: null,
  });

  if (!result?.sentVideo) {
    throw new Error('Instagram Telegram e2e did not return a sentVideo message.');
  }

  console.log('INSTAGRAM_TELEGRAM_E2E_PASSED', JSON.stringify({
    ok: true,
    ms: Date.now() - started,
    messageId: result.sentVideo?.message_id || null,
    fileId: result.sentVideo?.video?.file_id || null,
    duration: result.sentVideo?.video?.duration || null,
    width: result.sentVideo?.video?.width || null,
    height: result.sentVideo?.video?.height || null,
  }));
}

main().catch((error) => {
  console.error('INSTAGRAM_TELEGRAM_E2E_FAILED', error?.stack || error?.message || error);
  process.exit(1);
});
