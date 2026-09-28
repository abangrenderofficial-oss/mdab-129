import { mkdir, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

const targetDir = path.join(process.cwd(), 'bin');
const target = path.join(targetDir, 'yt-dlp');
const realTarget = path.join(targetDir, 'yt-dlp-real');
const source = process.env.YTDLP_BINARY_URL || 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

await mkdir(targetDir, { recursive: true });

const response = await fetch(source, {
  redirect: 'follow',
  headers: { 'User-Agent': 'ARDownloader-build/1.0' },
});

if (!response.ok) {
  throw new Error(`Failed to download yt-dlp standalone binary: HTTP ${response.status}`);
}

const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.length < 1_000_000) {
  throw new Error(`yt-dlp binary looks too small (${bytes.length} bytes)`);
}

await writeFile(realTarget, bytes);
await chmod(realTarget, 0o755);

// Instagram's logged-out web extractor is inconsistent: the same Reel can
// expose DASH audio on one request and video-only formats on the next. Keep
// the normal web request first, then transparently retry the iOS extractor
// only for Instagram JSON probes when the first result has no usable audio.
const wrapper = `#!/bin/sh
REAL="$(dirname "$0")/yt-dlp-real"
IS_DUMP=0
IS_IG=0
HAS_IOS=0
for ARG in "$@"; do
  case "$ARG" in
    --dump-single-json) IS_DUMP=1 ;;
    *instagram.com/*) IS_IG=1 ;;
    instagram:app_id=ios) HAS_IOS=1 ;;
  esac
done

if [ "$IS_DUMP" = "1" ] && [ "$IS_IG" = "1" ] && [ "$HAS_IOS" = "0" ]; then
  TMP="$(mktemp)"
  "$REAL" "$@" >"$TMP"
  CODE=$?
  if [ "$CODE" -eq 0 ]; then
    if grep -Eo '"acodec"[[:space:]]*:[[:space:]]*"[^"]+"' "$TMP" | grep -vq '"none"'; then
      cat "$TMP"
      rm -f "$TMP"
      exit 0
    fi
  fi
  rm -f "$TMP"
  "$REAL" --extractor-args 'instagram:app_id=ios' "$@"
  exit $?
fi

exec "$REAL" "$@"
`;

await writeFile(target, wrapper, 'utf8');
await chmod(target, 0o755);
console.log(`Installed standalone yt-dlp (${bytes.length} bytes) -> ${realTarget}`);
console.log(`Installed Instagram web->iOS retry wrapper -> ${target}`);
