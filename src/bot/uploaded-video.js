// Keep document file_ids as documents when echoing them to Telegram. They can
// still be downloaded and passed to the existing video encoders unchanged.
export function uploadedVideo(message = {}) {
  if (message?.video?.file_id) return message.video;
  const document = message?.document;
  if (!document?.file_id) return null;

  const mime = String(document.mime_type || '').split(';')[0].trim().toLowerCase();
  if (mime.startsWith('video/')) return document;
  // Some clients send MOV/MP4 files as generic binary documents.
  if ((!mime || mime === 'application/octet-stream')
    && /\.(mp4|mov|m4v|webm|mkv|avi|3gp|3g2|mpeg|mpg|mts|m2ts)$/i.test(String(document.file_name || ''))) {
    return document;
  }
  return null;
}
