import { uploadedPhoto, uploadedPhotoError } from '../bot/uploaded-photo.js';
import { uploadedVideo } from '../bot/uploaded-video.js';
import { mirrorMediaToGroup } from '../bot/audit.js';
import { galleryMediaActionButtons, MEDIA_STATUS_HQ } from '../bot/media-actions.js';
import { sendChatAction, sendMessage, telegram } from '../telegram.js';

export const MAX_GALLERY_VIDEO_BYTES = 200 * 1024 * 1024;

// Native (non-Document) photos/videos are capped at 20 MB. Anything heavier
// must be resent as a File/Document so the original bytes reach the
// Premium+ HQ encoder untouched (via the MTProto heavy worker).
export const MAX_NATIVE_MEDIA_BYTES = 20 * 1024 * 1024;
export const NATIVE_MEDIA_TOO_LARGE_TEXT = '❌ Media larger than 20 MB is not accepted. Please make sure you send it as a Document (File).';

export function isGalleryVideoTooLarge(fileSize = 0) {
  const bytes = Number(fileSize || 0);
  return Number.isFinite(bytes) && bytes > MAX_GALLERY_VIDEO_BYTES;
}

export function isNativeMediaTooLarge(message = {}) {
  const native = message?.video?.file_id
    ? message.video
    : (Array.isArray(message?.photo) && message.photo.length ? message.photo.at(-1) : null);
  if (!native) return false;
  const bytes = Number(native.file_size || 0);
  return Number.isFinite(bytes) && bytes > MAX_NATIVE_MEDIA_BYTES;
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '-';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function uploadedVideoCaption(video = {}) {
  const width = Number(video.width || 0);
  const height = Number(video.height || 0);
  const duration = Number(video.duration || 0);
  return [
    '🎬 Video diterima',
    width && height ? `📐 ${width} × ${height}` : null,
    duration ? `⏱️ ${duration}s` : null,
    video.file_size ? `📦 ${formatFileSize(video.file_size)}` : null,
    '',
    'Pilih fungsi:',
  ].filter((line) => line !== null).join('\n').slice(0, 1024);
}

function uploadedPhotoCaption(photo = {}, showActions = true) {
  const width = Number(photo.width || 0);
  const height = Number(photo.height || 0);
  return [
    '🖼️ Gambar diterima',
    width && height ? `📐 ${width} × ${height}` : null,
    photo.file_size ? `📦 ${formatFileSize(photo.file_size)}` : null,
    ...(showActions ? ['', 'Pilih fungsi:'] : []),
  ].filter((line) => line !== null).join('\n').slice(0, 1024);
}

function uploadedPhotoActions() {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: '✨ Premium+ 𝗛𝗤', callback_data: MEDIA_STATUS_HQ },
      ]],
    },
  };
}

export async function processUploadedPhoto(message, context = {}) {
  const chatId = message?.chat?.id;
  if (!chatId) return false;
  if (isNativeMediaTooLarge(message)) {
    await sendMessage(chatId, NATIVE_MEDIA_TOO_LARGE_TEXT);
    return true;
  }
  const error = uploadedPhotoError(message);
  if (error) {
    await sendMessage(chatId, error);
    return true;
  }
  const photo = uploadedPhoto(message);
  if (!chatId || !photo?.file_id) return false;

  const isDocument = Boolean(message?.document?.file_id) && !message?.photo?.length;
  await sendChatAction(chatId, isDocument ? 'upload_document' : 'upload_photo').catch(() => {});
  try {
    await telegram(isDocument ? 'sendDocument' : 'sendPhoto', {
      chat_id: chatId,
      [isDocument ? 'document' : 'photo']: photo.file_id,
      caption: isDocument
        ? `${uploadedPhotoCaption(photo)}\n\n📎 Diterima sebagai File/Document.`.slice(0, 1024)
        : `${uploadedPhotoCaption(photo, false)}\n\n⚠️ Photo sudah dikompres Telegram. Untuk Premium+ HQ tanpa hilang detail, hantar sebagai File/Document.`.slice(0, 1024),
      // An ordinary Telegram Photo is already lossy; don't advertise a fake
      // Premium+ HQ action that cannot restore missing pixels. File mode only.
      ...(isDocument ? uploadedPhotoActions() : {}),
    });
  } finally {
    await mirrorMediaToGroup(chatId, message, context.mirrorGroupId, message.from, {
      platform: 'gallery',
      sourceMessageId: message?.message_id,
      sourceTimestamp: message?.date,
    }).catch(() => {});
  }
  return true;
}

export async function processUploadedVideo(message, context = {}) {
  const chatId = message?.chat?.id;
  const video = uploadedVideo(message);
  if (!chatId || !video?.file_id) return false;

  const fileSize = Number(video?.file_size || 0);
  if (isNativeMediaTooLarge(message)) {
    await sendMessage(chatId, NATIVE_MEDIA_TOO_LARGE_TEXT);
    return true;
  }
  if (isGalleryVideoTooLarge(fileSize)) {
    await sendMessage(chatId, '❌ Video terlalu besar. Maksimum upload video ialah 200MB.');
    return true;
  }

  const actions = galleryMediaActionButtons(message?.message_id, video?.file_size);
  const isDocument = !message?.video?.file_id && Boolean(message?.document?.file_id);
  await sendChatAction(chatId, isDocument ? 'upload_document' : 'upload_video').catch(() => {});
  try {
    if (isDocument) {
      await telegram('sendDocument', {
        chat_id: chatId,
        document: video.file_id,
        caption: `${uploadedVideoCaption(video)}\n\n📎 Diterima sebagai File/Document.`.slice(0, 1024),
        ...actions,
      });
    } else {
      await telegram('sendVideo', {
        chat_id: chatId,
        video: video.file_id,
        caption: uploadedVideoCaption(video),
        supports_streaming: true,
        ...(Number(video?.width || 0) > 0 ? { width: Number(video.width) } : {}),
        ...(Number(video?.height || 0) > 0 ? { height: Number(video.height) } : {}),
        ...(Number(video?.duration || 0) > 0 ? { duration: Number(video.duration) } : {}),
        ...actions,
      });
    }
  } finally {
    await mirrorMediaToGroup(chatId, message, context.mirrorGroupId, message.from, {
      platform: 'gallery',
      sourceMessageId: message?.message_id,
      sourceTimestamp: message?.date,
    }).catch(() => {});
  }
  return true;
}

