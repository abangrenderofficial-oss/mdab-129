import { prepareStatusFromSourceUrl } from '../src/features/status-hq.js';
import { sendVideoFileUpload } from '../src/telegram.js';
import {
  MEDIA_STATUS_HQ,
  MEDIA_STATUS_HQ_MENU,
  callbackData,
  callbackSourceUrl,
} from '../src/bot/media-actions.js';

const url = String(process.env.INSTAGRAM_STORY_SMOKE_URL || '').trim();
const chatId = Number(process.env.BOT_OWNER_ID || 0);

async function main() {
  if (!/instagram\.com\/stories\/[^/]+\/\d+/i.test(url)) {
    console.log('INSTAGRAM_STORY_HQ_SMOKE_SKIPPED no-story-url');
    return;
  }

  const menuData = callbackData(MEDIA_STATUS_HQ_MENU, url);
  const menuRoundTrip = callbackSourceUrl(menuData, MEDIA_STATUS_HQ_MENU, '');
  const premiumData = callbackData(MEDIA_STATUS_HQ, menuRoundTrip);
  const premiumRoundTrip = callbackSourceUrl(premiumData, MEDIA_STATUS_HQ, '');
  if (!/instagram\.com\/stories\/[^/]+\/\d+/i.test(menuRoundTrip) || premiumRoundTrip !== menuRoundTrip) {
    throw new Error(`Story callback round-trip failed: ${menuData} -> ${menuRoundTrip} -> ${premiumData} -> ${premiumRoundTrip}`);
  }
  console.log('INSTAGRAM_STORY_CALLBACK_ROUNDTRIP_PASSED', JSON.stringify({
    menuBytes: Buffer.byteLength(menuData),
    premiumBytes: Buffer.byteLength(premiumData),
    source: premiumRoundTrip,
  }));

  let prepared = null;
  try {
    const started = Date.now();
    prepared = await prepareStatusFromSourceUrl(url, 'instagram');
    if (prepared?.profile?.mode !== 'instagram-story-premium-hq') {
      throw new Error(`Unexpected Story HQ profile: ${prepared?.profile?.mode || 'missing'}`);
    }
    if (!prepared?.filePath || !prepared?.size) throw new Error('Story HQ encoder returned no output file.');

    console.log('INSTAGRAM_STORY_HQ_ENCODE_PASSED', JSON.stringify({
      ms: Date.now() - started,
      bytes: prepared.size,
      profile: prepared.profile,
      source: prepared.source,
    }));

    if (Number.isFinite(chatId) && chatId > 0) {
      const sent = await sendVideoFileUpload(chatId, prepared.filePath, 'Instagram Story Premium+ HQ TEST');
      console.log('INSTAGRAM_STORY_HQ_TELEGRAM_E2E_PASSED', JSON.stringify({
        messageId: sent?.message_id || null,
        fileId: sent?.video?.file_id || null,
        duration: sent?.video?.duration || null,
        width: sent?.video?.width || null,
        height: sent?.video?.height || null,
      }));
    } else {
      console.log('INSTAGRAM_STORY_HQ_TELEGRAM_E2E_SKIPPED no-owner-chat');
    }
  } finally {
    await prepared?.cleanup?.().catch(() => {});
  }
}

main().catch((error) => {
  console.error('INSTAGRAM_STORY_HQ_SMOKE_FAILED', error?.stack || error?.message || error);
  process.exit(1);
});
