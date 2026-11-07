"""Isolated TikTok oversize fallback. Preserves the existing MediaX social-video FFmpeg formula."""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import urlparse
import requests

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
CHAT_ID = os.environ.get("SOCIAL_CHAT_ID", "").strip()
SOURCE_URL = os.environ.get("SOCIAL_SOURCE_URL", "").strip()
STREAM_URL = os.environ.get("SOCIAL_STREAM_URL", "").strip()
MAX_BYTES = 50 * 1024 * 1024
MAX_SOURCE_BYTES = 500 * 1024 * 1024
BOT_ENDPOINT = "https://api.telegram.org/bot" + BOT_TOKEN + "/"


def telegram(method, data=None, files=None, timeout=70):
    result = requests.post(BOT_ENDPOINT + method, data=data or {}, files=files,
                           timeout=timeout)
    try:
        response = result.json()
    except ValueError as exc:
        raise RuntimeError("Telegram API response was not JSON") from exc
    if not response.get("ok"):
        raise RuntimeError("Telegram " + method + ": " +
                           str(response.get("description") or result.status_code))
    return response.get("result")


def notify(text):
    try:
        telegram("sendMessage", {"chat_id": CHAT_ID, "text": text[:3900]}, timeout=25)
    except Exception as error:
        print("Notification failed:", str(error)[:200], flush=True)


def run(cmd, timeout):
    result = subprocess.run(cmd, check=False, capture_output=True, text=True,
                            timeout=timeout)
    if result.returncode != 0:
        details = (result.stderr or result.stdout or "").strip()
        raise RuntimeError("Command failed (exit " + str(result.returncode) +
                           "): " + details[-650:])
    return result


def validate():
    if not BOT_TOKEN or not CHAT_ID.lstrip("-").isdigit():
        raise RuntimeError("Telegram worker configuration missing")
    host = urlparse(SOURCE_URL).hostname or ""
    if host != "tiktok.com" and not host.endswith(".tiktok.com"):
        raise RuntimeError("Worker accepts TikTok links only")


def download(workdir):
    template = str(workdir / "source.%(ext)s")
    command = [
        sys.executable, "-m", "yt_dlp",
        "--no-playlist", "--no-warnings", "--no-check-certificates",
        "--js-runtimes", "node",
        "--remote-components", "ejs:github",
        "--force-ipv4", "--max-filesize", "500M",
        "--format", "best[ext=mp4]/best", "--merge-output-format", "mp4",
        "--no-progress", "--output", template,
        "--print", "after_move:filepath",
        "--", SOURCE_URL,
    ]
    result = run(command, 240)
    lines = [s.strip() for s in result.stdout.splitlines() if s.strip()]
    candidates = [Path(lines[-1])] if lines else []
    candidates += list(workdir.glob("source.*"))
    for path in candidates:
        if path.is_file() and path.stat().st_size:
            if path.stat().st_size > MAX_SOURCE_BYTES:
                raise RuntimeError("Input exceeds 500 MiB safety limit")
            print("Source downloaded:", path.stat().st_size, "bytes", flush=True)
            return path
    raise RuntimeError("yt-dlp returned no source file")


def download_stream(workdir):
    parsed = urlparse(STREAM_URL)
    if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".apps.bot-hosting.cloud") or parsed.path != "/api/oversize-tiktok-source":
        raise RuntimeError("Invalid trusted MediaX source stream URL")
    destination = workdir / "source.mp4"
    with requests.get(STREAM_URL, stream=True, timeout=(30, 300)) as response:
        response.raise_for_status()
        total = 0
        with destination.open("wb") as out:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_SOURCE_BYTES:
                    raise RuntimeError("Worker source stream exceeds 500 MiB")
                out.write(chunk)
    if total == 0:
        raise RuntimeError("MediaX source stream returned an empty video")
    print("SOURCE_STREAM_TRANSFERRED", total, "bytes", flush=True)
    return destination


def probe(path):
    result = run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration",
        "-of", "json", str(path)
    ], 30)
    data = json.loads(result.stdout or "{}")
    stream = (data.get("streams") or [{}])[0]
    duration = float((data.get("format") or {}).get("duration") or 0)
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    if not (0 < duration <= 3600 and width > 0 and height > 0):
        raise RuntimeError("Invalid video duration or dimensions")
    return duration, width, height


def encode(source, dest, duration, width, height, safety):
    # Identical rate planning, resolution selection and FFmpeg codec options to
    # src/social-video.js; worker merely supplies additional CPU.
    target_bytes = math.floor(MAX_BYTES * safety)
    audio_kbps = 96 if duration > 600 else 128
    total_kbps = math.floor(target_bytes * 8 / duration / 1000)
    video_kbps = total_kbps - audio_kbps - 32
    if video_kbps < 550:
        raise RuntimeError("Video too long for acceptable Telegram compression")
    if video_kbps >= 2200:
        desired = 1920
    elif video_kbps >= 1000:
        desired = 1280
    else:
        desired = 854
    dimension = min(max(width, height), desired)
    max_rate = max(video_kbps, math.floor(video_kbps * 1.08))
    bufsize = max(video_kbps * 2, 1000)
    scale = (f"scale={dimension}:{dimension}:"
             "force_original_aspect_ratio=decrease:"
             "force_divisible_by=2:flags=lanczos")
    command = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-nostats",
        "-nostdin", "-i", str(source), "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", scale, "-c:v", "libx264",
        "-threads", "2", "-preset", "veryfast",
        "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-b:v", f"{video_kbps}k", "-maxrate", f"{max_rate}k",
        "-bufsize", f"{bufsize}k", "-c:a", "aac", "-b:a", f"{audio_kbps}k",
        "-ac", "2", "-movflags", "+faststart", "-map_metadata", "-1",
        str(dest),
    ]
    print("Encoding:", {"duration": duration, "maxDimension": dimension,
                        "videoKbps": video_kbps, "safety": safety}, flush=True)
    run(command, 900)
    size = dest.stat().st_size if dest.exists() else 0
    print("Encoded bytes:", size, flush=True)
    if size == 0:
        raise RuntimeError("FFmpeg produced an empty result")
    return size


def send_video(path):
    with path.open("rb") as video:
        result = telegram("sendVideo", {
            "chat_id": CHAT_ID,
            "supports_streaming": "true",
            "caption": "✅ MediaX Downloader — Video TikTok siap!",
        }, files={"video": ("video.mp4", video, "video/mp4")}, timeout=240)
    if not result or not (result.get("video") or result.get("document")):
        raise RuntimeError("Telegram returned no video attachment")
    print("VIDEO_DELIVERED_SUCCESSFULLY", flush=True)


def main():
    validate()
    notify("🎞️ Video TikTok ini terlalu besar untuk server bot. MediaX sedang memprosesnya melalui worker berasingan. Video akan dihantar di sini selepas siap.")
    with tempfile.TemporaryDirectory(prefix="mediax-oversize-") as temp:
        root = Path(temp)
        source = download_stream(root) if STREAM_URL else download(root)
        if source.stat().st_size <= MAX_BYTES:
            send_video(source)
            return
        duration, width, height = probe(source)
        output = root / "output.mp4"
        for safety in (0.82, 0.70):
            if output.exists():
                output.unlink()
            size = encode(source, output, duration, width, height, safety)
            if size <= MAX_BYTES:
                send_video(output)
                return
        raise RuntimeError("Video masih melebihi had Telegram selepas compression")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("WORKER_FAILED:", str(error)[:900], file=sys.stderr, flush=True)
        if CHAT_ID.lstrip("-").isdigit() and BOT_TOKEN:
            notify("❌ MediaX belum berjaya siapkan video TikTok yang terlalu besar ini. Cuba pautan lain atau laporkan kepada admin.")
        sys.exit(1)
