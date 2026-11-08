import assert from 'node:assert/strict';
import {
  NATIVE_DOCUMENT_UPLOAD_GUIDE,
  isNativeGalleryMedia,
  processNativeMediaGuide,
  processGalleryUploadWithSupport,
} from '../src/bot/gated-media-flow.js';

const originalFetch = globalThis.fetch;
const originalToken = process.env.TELEGRAM_BOT_TOKEN;
process.env.TELEGRAM_BOT_TOKEN = '123456789:unit_test_token';
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  const method = String(url).match(/\/bot[^/]+\/([^/?]+)/)?.[1] || '';
  const body = JSON.parse(options.body || '{}');
  calls.push({ method, body });
  return new Response(JSON.stringify({
    ok: true, result: { message_id: 8765, chat: { id: body.chat_id } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const message = (part) => ({
  chat: { id: 123456789, type: 'private' },
  from: { id: 123456789, first_name: 'Test' },
  message_id: 200,
  date: Math.floor(Date.now() / 1000),
  ...part,
});

try {
  assert.match(NATIVE_DOCUMENT_UPLOAD_GUIDE, /File\/Document/);
  assert.match(NATIVE_DOCUMENT_UPLOAD_GUIDE, /already blurry or pixelated/);
  assert.match(NATIVE_DOCUMENT_UPLOAD_GUIDE, /prevent extra quality loss/);
  assert.match(NATIVE_DOCUMENT_UPLOAD_GUIDE, /📁✅/);
  assert.match(NATIVE_DOCUMENT_UPLOAD_GUIDE, /☝🏻/);

  const nativePhoto = message({ photo: [
    { file_id: 'small_photo', width: 100, height: 100 },
    { file_id: 'large_photo', width: 1254, height: 1254, file_size: 116 * 1024 },
  ] });
  const nativeVideo = message({ video: {
    file_id: 'native_video', width: 1080, height: 1920, file_size: 8 * 1024 * 1024,
  } });
  const documentPhoto = message({ document: {
    file_id: 'original_png', file_name: 'original.png', mime_type: 'image/png',
    file_size: 4 * 1024 * 1024,
  } });
  const documentVideo = message({ document: {
    file_id: 'original_video', file_name: 'original.mov', mime_type: 'video/quicktime',
    file_size: 30 * 1024 * 1024,
  } });

  assert.equal(isNativeGalleryMedia(nativePhoto), true);
  assert.equal(isNativeGalleryMedia(nativeVideo), true);
  assert.equal(isNativeGalleryMedia(documentPhoto), false);
  assert.equal(isNativeGalleryMedia(documentVideo), false);
  assert.equal(isNativeGalleryMedia(message({ text: 'https://vt.tiktok.com/test/' })), false);

  assert.equal(await processNativeMediaGuide(nativePhoto), true);
  assert.equal(await processNativeMediaGuide(nativeVideo), true);
  assert.equal(await processGalleryUploadWithSupport(nativePhoto), true);
  assert.equal(await processGalleryUploadWithSupport(nativeVideo), true);
  assert.equal(await processNativeMediaGuide(documentPhoto), false);
  assert.equal(await processNativeMediaGuide(documentVideo), false);

  assert.equal(calls.length, 4, 'one reply per native upload, none for Documents');
  assert.ok(calls.every(c => c.method === 'sendMessage'), 'never echo photo or video');
  assert.ok(calls.every(c => c.body.text === NATIVE_DOCUMENT_UPLOAD_GUIDE));
  assert.ok(calls.every(c => !c.body.reply_markup), 'no HQ buttons shown');
  console.log('MEDIAX_NATIVE_DOCUMENT_GUIDE_TEST_OK — native Photo/Video each get only one English guidance message, Documents untouched, no echo, no support quota');
} finally {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = originalToken;
}
