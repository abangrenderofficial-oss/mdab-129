// Image documents retain their file_id/type until the existing image HQ path
// downloads them. Do not reuse a document file_id with Telegram sendPhoto.
const IMAGE_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/x-png',
  'image/webp', 'image/bmp', 'image/x-ms-bmp', 'image/tiff',
]);
const IMAGE_EXTENSION = /\.(jpe?g|png|webp|bmp|tiff?)$/i;
export const MAX_IMAGE_DOCUMENT_BYTES = 20 * 1024 * 1024;

export function uploadedPhoto(message = {}) {
  if (Array.isArray(message?.photo) && message.photo.length) return message.photo.at(-1);
  const document = message?.document;
  if (!document?.file_id) return null;
  const mime = String(document.mime_type || '').split(';')[0].trim().toLowerCase();
  if (IMAGE_MIME.has(mime)) return document;
  if ((!mime || mime === 'application/octet-stream')
    && IMAGE_EXTENSION.test(String(document.file_name || ''))) return document;
  return null;
}

export function uploadedPhotoError(message = {}) {
  const document = message?.document;
  if (!document?.file_id || message?.photo?.length || message?.video?.file_id) return '';
  if (uploadedPhoto(message)) {
    if (Number(document.file_size || 0) > MAX_IMAGE_DOCUMENT_BYTES) {
      return '❌ Fail gambar terlalu besar. Maksimum gambar sebagai File/Document ialah 20MB.';
    }
    return '';
  }
  const mime = String(document.mime_type || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(heic|heif|avif|gif|svg)$/i.test(String(document.file_name || ''))) {
    return '❌ Format gambar ini belum disokong untuk Premium+ HQ. Sila eksport sebagai JPG, PNG atau WEBP dan hantar semula sebagai File/Document.';
  }
  return '';
}
