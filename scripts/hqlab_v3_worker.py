"""Owner-only HQ Lab V3: separate from production Premium+ HQ."""
import json
import math
import os
import subprocess
import tempfile
from pathlib import Path

import requests
from pyrogram import Client

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
API_ID = int(os.getenv("TELEGRAM_API_ID") or 0)
API_HASH = os.getenv("TELEGRAM_API_HASH", "")
CHAT_ID = int(os.getenv("HQLAB_V3_CHAT_ID") or 0)
USER_ID = int(os.getenv("HQLAB_V3_USER_ID") or 0)
FILE_ID = os.getenv("HQLAB_V3_FILE_ID", "")
SIZE = int(os.getenv("HQLAB_V3_FILE_SIZE") or 0)
MAX_SOURCE = 500 * 1024 * 1024
MAX_OUTPUT = 10_000_000
TARGET_OUTPUT = 9_450_000


def telegram(method, data=None, files=None, timeout=120):
    r = requests.post(
        "https://api.telegram.org/bot" + BOT_TOKEN + "/" + method,
        data=data or {}, files=files, timeout=timeout)
    j = r.json()
    if not r.ok or not j.get("ok"):
        raise RuntimeError(str(j.get("description") or method + " failed"))
    return j.get("result")


def notify(message):
    if CHAT_ID > 0:
        try:
            telegram("sendMessage", {"chat_id": str(CHAT_ID), "text": message[:3500]}, timeout=30)
        except Exception as error:
            print("HQ Lab V3 notify failure:", error, flush=True)


def run(args, timeout=1200):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError("ffmpeg error: " + result.stderr[-1300:])
    return result.stdout


def probe(path):
    payload = json.loads(run([
        "ffprobe", "-v", "error", "-show_entries",
        "stream=codec_type,width,height,avg_frame_rate:format=duration",
        "-of", "json", str(path)], timeout=60))
    streams = payload.get("streams") or []
    v = next((x for x in streams if x.get("codec_type") == "video"), {})
    a = any(x.get("codec_type") == "audio" for x in streams)
    duration = float((payload.get("format") or {}).get("duration") or 0)
    w, h = int(v.get("width") or 0), int(v.get("height") or 0)
    if not duration or not w or not h:
        raise RuntimeError("Metadata video tak dapat dibaca")
    return {"duration": duration, "width": w, "height": h,
            "audio": a, "fps": v.get("avg_frame_rate") or "0/1"}


def video_filter(info):
    w, h = info["width"], info["height"]
    if abs(w - h) / max(w, h) < .08:
        max_w, max_h = 1080, 1080
    elif w > h:
        max_w, max_h = 1920, 1080
    else:
        max_w, max_h = 1080, 1920
    factor = min(1.0, max_w / w, max_h / h)
    nw = max(2, int(math.floor(w * factor / 2) * 2))
    nh = max(2, int(math.floor(h * factor / 2) * 2))
    return f"scale={nw}:{nh}:flags=lanczos,setsar=1,fps=60"


def encode(src, dest, info, temp):
    audio_kbps = 128 if info["audio"] else 0
    budget = int(TARGET_OUTPUT * 8 / info["duration"] / 1000 * .97)
    planned = min(10000, budget - audio_kbps - 55)
    if planned < 180:
        raise RuntimeError("Video terlalu panjang untuk 1080p60 di bawah 10 MB. Potong durasi.")
    vf = video_filter(info)
    for attempt, multiplier in enumerate((1, .82, .67, .52), 1):
        rate = max(160, int(planned * multiplier))
        pass_log = str(temp / ("v3-pass-" + str(attempt)))
        if dest.exists():
            dest.unlink()
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
            "-i", str(src), "-map", "0:v:0", "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-profile:v", "high", "-level:v", "4.2", "-g", "120",
            "-b:v", f"{rate}k", "-maxrate", f"{min(10000, int(rate * 1.08))}k",
            "-bufsize", f"{max(1000, rate * 2)}k", "-passlogfile", pass_log,
            "-threads", "2",
        ]
        run(cmd + ["-pass", "1", "-an", "-f", "null", os.devnull])
        sound = (["-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k",
                  "-ar", "48000", "-ac", "2"] if info["audio"] else ["-an"])
        run(cmd + ["-pass", "2"] + sound + [
            "-movflags", "+faststart", "-tag:v", "avc1", "-f", "mp4", str(dest)])
        size = dest.stat().st_size
        print(f"HQ Lab V3: attempt={attempt}, rate={rate} kbps, bytes={size}", flush=True)
        if size <= 10_000_000:
            result = probe(dest)
            if result["fps"] != "60/1":
                raise RuntimeError("Output FPS bukan 60: " + str(result["fps"]))
            if info["audio"] and not result["audio"]:
                raise RuntimeError("Audio hilang dalam output V3")
            return size, rate, result
    raise RuntimeError("Output gagal capai bawah 10 MB; cuba video lebih pendek")


def main():
    if not BOT_TOKEN or not API_ID or not API_HASH or not FILE_ID:
        raise RuntimeError("Worker V3 tidak lengkap konfigurasi")
    if not CHAT_ID or CHAT_ID != USER_ID:
        raise RuntimeError("HQ Lab V3 hanya boleh digunakan dalam private owner chat")
    if SIZE > MAX_SOURCE:
        raise RuntimeError("Saiz Document lebih 500 MiB")
    notify("🧪 HQ Lab V3: Document diterima. Encoding 1080p / 60 FPS / maks 10 MB.")
    with tempfile.TemporaryDirectory(prefix="hqlab-v3-") as directory:
        work = Path(directory)
        source = work / "source.bin"
        output = work / "premium-hq-v3.mp4"
        app = Client("hqlab_v3_owner", api_id=API_ID, api_hash=API_HASH,
                     bot_token=BOT_TOKEN, in_memory=True)
        with app:
            downloaded = app.download_media(FILE_ID, file_name=str(source))
        if not downloaded or not source.exists():
            raise RuntimeError("MTProto tidak dapat download Document")
        if source.stat().st_size > MAX_SOURCE:
            raise RuntimeError("Document lebih 500 MiB")
        info = probe(source)
        print("HQ Lab V3 input:", info, flush=True)
        size, kbps, result = encode(source, output, info, work)
        caption = (
            "🧪 Premium + HQ V3 — OWNER TEST\n"
            f"📐 {result['width']} × {result['height']}\n"
            "🎞️ 60 FPS\n"
            f"📊 Video bitrate target: {kbps} kbps (max 10000 kbps)\n"
            f"📦 {size / 1_000_000:.2f} MB / 10 MB\n"
            "📎 MP4 Document asal selepas encode. Production HQ tidak diubah.")
        with output.open("rb") as fd:
            telegram("sendDocument", {"chat_id": str(CHAT_ID), "caption": caption},
                     {"document": ("Premium-HQ-V3-1080p60.mp4", fd, "video/mp4")},
                     timeout=300)
    print("HQ Lab V3 sent", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("HQ Lab V3 failed:", error, flush=True)
        notify("❌ HQ Lab V3 gagal: " + str(error)[:250])
        raise
