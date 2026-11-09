// Read-only migration invariant: Git blob SHA for ALL protected quality pipelines.
// Baseline media quality guard; the uploaded photo Premium+ HQ path is explicitly
// upgraded to preserve original JPEG bytes and dimensions (2026-10-18).
// Video and image input adapters accept File/Document uploads (2026-11-01).
// Native media capped at 20 MB; image Documents >20 MB routed to the MTProto
// status_hq_image worker (2026-11-04). Encoders/presets unchanged.
// Encoder, audio and worker pipelines retain their existing quality baseline.
// Uploaded-video Premium+ HQ (gallery only) upgraded to upload-v3 profile
// (real x265 preset, scene cuts, aq-mode 3, native fps, HDR->SDR) 2026-11-09.
// Upload bitrate ceiling via STATUS_UPLOAD_MAXRATE_KBPS (default 5000), forwarded
// to the heavy worker as upload_maxrate_kbps (gallery status_hq only).
// Upload-v4 TDS (2026-11-09): every uploaded video -> GitHub worker, StatusDrop
// 1080p spec + temporal denoise + light sharpen, split into <=29s parts.
// Link-based Premium+ HQ formula unchanged.
// It checks byte-identical implementations; it never changes media files or presets.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const expected = {
  "src/bot/uploaded-photo.js": "734a34f18ee16d6a3d9e9055127f5828dd666c14",
  "src/bot/uploaded-video.js": "3e83ed3d0e04f1b3759dbd933d5229c500d211fc",
  ".github/workflows/heavy-status-hq.yml": "ca8064811a8ad9df166ddaac4d10cb4b11fe8239",
  "scripts/apple_live_photo_pair.swift": "f072314bc088dbdc870a27b54652926ffc3b4377",
  "scripts/apple_live_worker.py": "b4ec9f400b11933e5f1fd5019c1baee7f6c8fb25",
  "scripts/heavy_status_android_worker.py": "d4d19ea1e0b46e229a5f6ea43a3df5938dd83ee4",
  "scripts/heavy_status_worker.py": "6703b18efd8eb58c1611df802d3a4a5f76b741f1",
  "src/hq-lab-premium-plus.js": "f138de3426d313e7578cd77df803443eb68db0b0",
  "src/hq-lab.js": "6b039fb0f99b7f9bd094106db3fa8c0d1af7849f",
  "src/status-hq.js": "6d8e58ad0fd55e80cba9d0418a6f6d3414309da2",
  "src/status-hq-android.js": "58adb78c9971463a5eaecbbfe002f0529d1fa74d",
  "src/status-image-hq.js": "d6bd4ddf40e34ed683f7fa6f9b5ef435b7809821",
  "src/live-wallpaper.js": "df08317783226f23228ec46eb3dae123319b502a",
  "src/live-photo-telegram.js": "4a4f014fbfe3db17505c64902897d4d67fb0262d",
  "src/features/hq-lab.js": "12115c6518c2d6529f031ff9a64c4d12f2bdb347",
  "src/features/status-hq-android.js": "1de79b7dc9830c00fa1d38319c89a568176817c5",
  "src/features/status-hq.js": "a43fe96def365e79fd8bd996ef5796bb2757a79d",
  "src/features/live-wallpaper.js": "682fbb11d8926b34ae65c3e14ec2206c765c3835",
  "src/instagram-video-audio-mux.js": "5df6c9607454e82634aed6cc3cafe5fdbf4e700c",
  "src/youtube-upload.js": "11bbe3adab000e4f0536fbe80f17284f64e736dd",
  "src/social-video.js": "71f833e2a062c12395fc63a6f7a188eceb80fe5f",
  "src/heavy-worker-dispatch.js": "e1c91565af1467722f51befb52e8245884a1b289"
};
let failures = 0;
for (const [path, sha] of Object.entries(expected)) {
  try {
    const bytes = await readFile(path);
    const blob = createHash('sha1').update('blob ' + bytes.length).update(Buffer.from([0])).update(bytes).digest('hex');
    if (blob !== sha) { console.error('[quality-guard] CHANGED:', path); failures++; }
  } catch (e) { console.error('[quality-guard] MISSING:', path, e.message); failures++; }
}
if (failures) {
  console.error('[quality-guard] FAIL:', failures, 'protected files do not match MediaX baseline');
  process.exitCode = 1;
} else {
  console.log('[quality-guard] PASS:', Object.keys(expected).length, 'HQ / Android / Live Wallpaper / audio / worker files match approved baseline');
}
