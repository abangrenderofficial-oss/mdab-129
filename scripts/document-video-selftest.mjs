import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Run the production upload/menu/callback functions with Telegram, database,
// worker dispatch and encoders replaced by spies. No external messages or jobs.
const root = process.cwd();
const realPaths = [
  'src/bot/uploaded-video.js', 'src/bot/uploaded-photo.js', 'src/bot/media-actions.js',
  'src/bot/gated-media-flow.js', 'src/features/uploaded-media.js',
  'src/features/status-hq-menu.js', 'src/features/status-hq.js',
  'src/features/status-hq-android.js', 'src/features/live-wallpaper.js',
];
const sources = new Map(realPaths.map(p => [path.resolve(root, p), fs.readFileSync(p, 'utf8')]));
const imports = new Map();
for (const [filename, source] of sources) {
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(filename), match[2]);
    if (!imports.has(target)) imports.set(target, new Set());
    for (const name of match[1].split(',').map(x => x.trim()).filter(Boolean)) imports.get(target).add(name);
  }
}
let calls = [];
let blocked = false;
let workerAvailable = true;
let claimed = true;
const MB = 1024 * 1024;
const progress = () => ({ complete: async () => {}, remove: async () => {} });
function spy(name) {
  return async (...args) => { calls.push({ name, args }); return undefined; };
}
const implementations = {
  telegram: async (method, payload) => {
    calls.push({ name: 'telegram', args: [method, payload] });
    if (method === 'editMessageReplyMarkup' && !claimed) throw new Error('already used');
    return { message_id: 50 };
  },
  getTelegramFileSource: async id => {
    calls.push({ name: 'source', args: [id] }); return { url: `mock:${id}` };
  },
  prepareWhatsAppStatusImageHQ: async input => {
    calls.push({ name: 'imageEncode', args: [input] });
    return { filePath: '/mock/status.jpg', cleanup: async () => {} };
  },
  sendDocumentFileUpload: spy('sendDocumentFileUpload'),
  prepareWhatsAppStatusHQ: async input => {
    calls.push({ name: 'premiumEncode', args: [input] });
    return { filePath: '/mock/status.mp4', profile: { hasAudio: true }, cleanup: async () => {} };
  },
  prepareWhatsAppStatusAndroidHQ: async input => {
    calls.push({ name: 'androidEncode', args: [input] });
    return { filePath: '/mock/android.mp4', cleanup: async () => {} };
  },
  localMediaLane: async job => job(),
  shouldUseHeavyWorker: video => video.file_size > 18 * MB,
  heavyVideoLimitBytes: () => 200 * MB,
  heavyWorkerConfigured: () => workerAvailable,
  dispatchHeavyMediaJob: spy('dispatch'),
  enforceFridaySupportForMessage: async () => blocked,
  enforceDailyForceSupportForMessage: async () => blocked,
  claimFridayUsageAttempt: async () => true,
  claimDailyForceUsageAttempt: async () => true,
  recordMediaXChannelCampaignUse: spy('recordUsage'),
  mirrorMediaToGroup: spy('mirror'),
  sendMessage: spy('sendMessage'),
  sendChatAction: spy('sendChatAction'),
  sendVideoFileUpload: spy('sendVideoFileUpload'),
  startStatusProgress: async () => progress(),
  startImageStatusProgress: async () => progress(),
  startHeavyStatusProgress: async () => ({ message_id: 70 }),
  startHeavyLiveProgress: async () => ({ message_id: 71 }),
  isJobFenceActive: () => true,
  extractFirstUrl: () => '',
  detectPlatform: () => null,
  statusVideoCaption: async () => 'HQ',
  statusAndroidVideoCaption: async () => 'Android HQ',
};
const modules = new Map();
function getModule(filename) {
  if (modules.has(filename)) return modules.get(filename);
  let mod;
  if (sources.has(filename)) {
    mod = new vm.SourceTextModule(sources.get(filename), { identifier: filename });
  } else {
    const names = [...(imports.get(filename) || [])];
    mod = new vm.SyntheticModule(names, function () {
      for (const name of names) this.setExport(name, implementations[name] || spy(name));
    }, { identifier: filename });
  }
  modules.set(filename, mod);
  return mod;
}
async function load(relative) {
  const mod = getModule(path.resolve(root, relative));
  if (mod.status === 'unlinked') await mod.link((specifier, parent) => getModule(path.resolve(path.dirname(parent.identifier), specifier)));
  if (mod.status === 'linked') await mod.evaluate();
  return mod.namespace;
}
const uploaded = await load('src/features/uploaded-media.js');
const gated = await load('src/bot/gated-media-flow.js');
const actions = await load('src/bot/media-actions.js');
const menu = await load('src/features/status-hq-menu.js');
const premium = await load('src/features/status-hq.js');
const android = await load('src/features/status-hq-android.js');
const live = await load('src/features/live-wallpaper.js');
const helper = await load('src/bot/uploaded-video.js');
const photoHelper = await load('src/bot/uploaded-photo.js');
function message(size = 5 * MB, document = true) {
  const media = { file_id: 'original-file', file_size: size, mime_type: 'video/quicktime', file_name: 'camera.MOV' };
  return { chat: { id: 123, type: 'private' }, from: { id: 123 }, message_id: 42, [document ? 'document' : 'video']: media };
}
function callback(msg, prefix) {
  return { id: 'callback', from: msg.from, message: { ...msg, message_id: 50 }, data: `${prefix}|g:42:${msg.document?.file_size || msg.video?.file_size}` };
}
function reset() { calls = []; blocked = false; workerAvailable = true; claimed = true; }
const called = name => calls.filter(c => c.name === name);
const telegramCall = method => calls.find(c => c.name === 'telegram' && c.args[0] === method)?.args[1];

assert.ok(helper.uploadedVideo(message()));
assert.ok(helper.uploadedVideo({ document: { file_id: 'x', file_name: 'clip.MP4', mime_type: 'application/octet-stream' } }));
assert.equal(helper.uploadedVideo({ document: { file_id: 'x', file_name: 'clip.mp4', mime_type: 'application/pdf' } }), null);
assert.equal(helper.uploadedVideo({ document: { file_id: 'x', file_name: 'data.zip' } }), null);

for (const asDocument of [true, false]) {
  reset();
  const msg = message(5 * MB, asDocument);
  assert.equal(await gated.processGalleryUploadWithSupport(msg), true);
  const echo = telegramCall(asDocument ? 'sendDocument' : 'sendVideo');
  assert.equal(echo[asDocument ? 'document' : 'video'], 'original-file');
  assert.equal(called('mirror').length, 1);
  assert.equal(called('recordUsage').length, 1);
  assert.ok(echo.reply_markup.inline_keyboard[0][0].callback_data.startsWith(actions.MEDIA_STATUS_HQ_MENU));
  reset();
  const menuCb = callback(msg, actions.MEDIA_STATUS_HQ_MENU);
  assert.equal(await menu.processStatusProfileMenu(menuCb), true);
  const profiles = telegramCall('editMessageReplyMarkup').reply_markup;
  assert.equal(profiles.inline_keyboard.length, 2);
  for (const [feature, prefix, encode, complete] of [
    [premium.processStatusButton, actions.MEDIA_STATUS_HQ, 'premiumEncode', 'premiumHqCompleted'],
    [android.processStatusAndroidButton, actions.MEDIA_STATUS_HQ_ANDROID, 'androidEncode', 'androidHqCompleted'],
  ]) {
    reset();
    const result = await feature(callback(msg, prefix));
    assert.equal(result[complete], true);
    assert.equal(called('source')[0].args[0], 'original-file');
    assert.equal(called(encode).length, 1);
    if (encode === 'premiumEncode') assert.equal(called(encode)[0].args[0].galleryCompatible, true);
    assert.equal(called('sendVideoFileUpload').length, 1);
    assert.equal(called('dispatch').length, 0);
  }
}
reset(); blocked = true;
assert.equal(await gated.processGalleryUploadWithSupport(message()), true);
assert.equal(telegramCall('sendDocument'), undefined);
reset();
assert.equal(await uploaded.processUploadedVideo(message(200 * MB + 1)), true);
assert.equal(telegramCall('sendDocument'), undefined);
assert.match(called('sendMessage')[0].args[1], /200MB/);
reset();
assert.equal(await uploaded.processUploadedVideo(message(200 * MB)), true);
assert.ok(telegramCall('sendDocument'));

for (const [feature, prefix, action] of [
  [premium.processStatusButton, actions.MEDIA_STATUS_HQ, 'status_hq'],
  [android.processStatusAndroidButton, actions.MEDIA_STATUS_HQ_ANDROID, 'status_hq_android'],
  [live.processLiveWallpaperButton, actions.MEDIA_LIVE_WALLPAPER, 'live_wallpaper'],
]) {
  reset();
  await feature(callback(message(116 * MB), prefix), { baseUrl: 'https://example.invalid' });
  const job = called('dispatch')[0].args[0];
  assert.equal(job.videoFileId, 'original-file');
  assert.equal(job.fileSize, 116 * MB);
  assert.equal(job.sourceMessageId, 42);
  assert.equal(job.sourceKind, 'gallery');
  assert.equal(job.action, action);
  assert.equal(called('source').length, 0); // Avoid Cloud Bot API's small-file download limit.
  reset(); workerAvailable = false;
  await feature(callback(message(116 * MB), prefix));
  assert.equal(called('dispatch').length, 0);
  assert.ok(telegramCall('answerCallbackQuery').show_alert);
}
reset(); claimed = false;
await premium.processStatusButton(callback(message(), actions.MEDIA_STATUS_HQ));
assert.equal(called('premiumEncode').length, 0);
assert.equal(called('source').length, 0);
console.log('Document/native video upload → profile menu → Premium/Android HQ: passed.');
console.log('116 MiB Document worker dispatch, 200 MiB boundaries, access gate and reused button checks: passed.');

for (const format of ['jpeg', 'png', 'webp', 'native']) {
  reset();
  const msg = { chat: { id: 123, type: 'private' }, from: { id: 123 }, message_id: 43 };
  if (format === 'native') msg.photo = [{ file_id: 'small' }, { file_id: 'original-image', width: 1183, height: 2560 }];
  else msg.document = { file_id: 'original-image', file_size: MB, mime_type: `image/${format}`, file_name: `original.${format}` };
  assert.equal(await gated.processGalleryUploadWithSupport(msg), true);
  const echo = telegramCall(format === 'native' ? 'sendPhoto' : 'sendDocument');
  assert.equal(echo[format === 'native' ? 'photo' : 'document'], 'original-image');
  assert.equal(called('mirror').length, 1);
  assert.equal(called('recordUsage').length, 1);
  assert.equal(echo.reply_markup.inline_keyboard[0][0].callback_data, actions.MEDIA_STATUS_HQ);
  reset();
  const cb = { id: 'image-callback', from: msg.from, message: { ...msg, message_id: 51 }, data: actions.MEDIA_STATUS_HQ };
  assert.equal(await menu.processStatusProfileMenu(cb), false);
  assert.equal((await premium.processStatusButton(cb)).premiumImageCompleted, true);
  assert.equal(called('source')[0].args[0], 'original-image');
  assert.equal(called('imageEncode')[0].args[0].image.url, 'mock:original-image');
  assert.equal(called('sendDocumentFileUpload').length, 1);
  assert.equal(called('dispatch').length, 0);
  assert.equal(called('premiumEncode').length, 0);
}
assert.ok(photoHelper.uploadedPhoto({document:{file_id:'x',file_name:'photo.JPG',mime_type:'application/octet-stream'}}));
assert.equal(photoHelper.uploadedPhoto({document:{file_id:'x',file_name:'photo.jpg',mime_type:'application/pdf'}}), null);
for (const [size, accepted] of [[20 * MB, true], [20 * MB + 1, false]]) {
  reset();
  const msg = {chat:{id:123},from:{id:123},message_id:43,document:{file_id:'photo',mime_type:'image/jpeg',file_size:size}};
  await gated.processGalleryUploadWithSupport(msg);
  assert.equal(Boolean(telegramCall('sendDocument')), accepted);
  assert.equal(called('recordUsage').length, accepted ? 1 : 0);
  if (!accepted) assert.match(called('sendMessage')[0].args[1], /20MB/);
}
for (const format of ['heic', 'svg+xml']) {
  reset();
  await gated.processGalleryUploadWithSupport({chat:{id:123},from:{id:123},document:{file_id:'image',mime_type:`image/${format}`}});
  assert.equal(called('recordUsage').length, 0);
  assert.equal(telegramCall('sendDocument'), undefined);
  assert.match(called('sendMessage')[0].args[1], /JPG, PNG atau WEBP/);
}
reset(); blocked = true;
await gated.processGalleryUploadWithSupport({chat:{id:123},from:{id:123},document:{file_id:'image',mime_type:'image/jpeg'}});
assert.equal(telegramCall('sendDocument'), undefined);
console.log('Image File/Document + native photo → Premium HQ, access, file-size and format checks: passed.');
