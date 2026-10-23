import assert from 'node:assert/strict';
import { resolveTikTokEmbeddedPhoto } from '../src/tiktok-photo-embed.js';

const id = '7681407159581642005';
const canonical = `https://www.tiktok.com/@creator/photo/${id}`;
const photo = {
  itemInfos: { id, text: 'Sample photo', video: { videoMeta: { duration: 9 } } },
  imagePostInfo: { displayImages: [
    { urlList: ['https://cdn.example.test/photo-1.jpg'] },
    { urlList: ['https://cdn.example.test/photo-2.jpg'] },
  ] },
  musicInfos: { musicName: 'Sample sound', authorName: 'Artist',
    playUrl: ['https://cdn.example.test/audio.mp3'] },
};
function page(videoData = photo) {
  const payload = { source: { data: {
    [`/embed/v2/${id}`]: { videoData },
  } } };
  return `<html><script id="__FRONTITY_CONNECT_STATE__" type="application/json">${JSON.stringify(payload)}</script></html>`;
}
function fetcher(data = photo) {
  const called = [];
  return {
    called,
    async fetchImpl(url) {
      called.push(url);
      if (String(url).includes('vt.tiktok.com')) return {
        url: canonical,
        body: { async cancel() {} },
      };
      return { ok: true, async text() { return page(data); } };
    },
  };
}

const direct = fetcher();
const item = await resolveTikTokEmbeddedPhoto(canonical, direct);
assert.equal(item.images.length, 2);
assert.equal(item.audio.title, 'Sample sound');
assert.equal(item.audio.url, 'https://cdn.example.test/audio.mp3');
assert.equal(item.videos.length, 0);
assert.equal(item.duration, 9);
assert.equal(item.source, 'tiktok-public-embed');
assert.equal(direct.called.length, 2); // page-first, embed fallback

const shortened = fetcher();
const shortItem = await resolveTikTokEmbeddedPhoto('https://vt.tiktok.com/SHORTCODE/', shortened);
assert.equal(shortItem.images.length, 2);
assert.equal(shortItem.canonicalUrl, canonical);
assert.equal(shortened.called.length, 3); // short redirect, page-first, embed
assert.equal(await resolveTikTokEmbeddedPhoto('https://example.com/photo/' + id, shortened), null);

const noSound = fetcher({ ...photo, musicInfos: {} });
assert.equal(await resolveTikTokEmbeddedPhoto(canonical, noSound), null);

const mismatched = fetcher({ ...photo, itemInfos: { ...photo.itemInfos, id: '1234567890123456789' } });
assert.equal(await resolveTikTokEmbeddedPhoto(canonical, mismatched), null);

const unsafe = fetcher({ ...photo, imagePostInfo: { displayImages: [{ urlList: ['javascript:alert(1)'] }] } });
assert.equal(await resolveTikTokEmbeddedPhoto(canonical, unsafe), null);

const video = fetcher();
const videoUrl = `https://www.tiktok.com/@creator/video/${id}`;
video.fetchImpl = async () => ({ url: videoUrl, body: { async cancel() {} } });
assert.equal(await resolveTikTokEmbeddedPhoto('https://vt.tiktok.com/VIDEO/', video), null);

let retryCount = 0;
const recovered = await resolveTikTokEmbeddedPhoto(canonical, {
  async fetchImpl() {
    retryCount++;
    if (retryCount === 1) return { ok: false, status: 500 };
    return { ok: true, async text() { return page(); } };
  },
});
assert.equal(recovered.images.length, 2);
assert.equal(retryCount, 2);

console.log('TIKTOK_PHOTO_EMBED_SELFTEST_OK: short URL, image+audio, video isolation, invalid assets, HTTP 500 recovery');
