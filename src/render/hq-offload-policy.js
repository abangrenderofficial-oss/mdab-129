/**
 * Render-only Status HQ offload decision.
 * This module cannot send Telegram messages or dispatch GitHub workflows.
 * Railway behavior is unchanged; Render must be explicitly active.
 */
export function decideStatusHqOffload({
  mode = '',
  isImage = false,
  videoFileId = '',
  gallery = false,
  fileSize = 0,
  galleryHeavyCandidate = false,
  maxBytes = 200 * 1024 * 1024,
} = {}) {
  const renderActive = mode === 'active';
  const videoReady = Boolean(String(videoFileId || '').trim());
  const bytes = Number(fileSize || 0);
  const oversized = Number.isFinite(bytes) && bytes > maxBytes;
  if (!renderActive) return {
    offload: Boolean(galleryHeavyCandidate), requiresVideo: false,
    reason: galleryHeavyCandidate ? 'legacy_gallery_heavy' : 'railway_local',
  };
  if (isImage) return { offload: false, requiresVideo: false, reason: 'image_local' };
  if (oversized) return { offload: false, requiresVideo: false, oversized: true, reason: 'oversized' };
  if (!videoReady) return {
    offload: false, requiresVideo: true, reason: 'telegram_video_file_id_missing',
  };
  return { offload: true, requiresVideo: false, reason: gallery ? 'render_gallery_video' : 'render_link_video' };
}
