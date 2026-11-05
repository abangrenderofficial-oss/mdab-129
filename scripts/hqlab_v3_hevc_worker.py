"""MediaX /hqlab owner-only HEVC two-pass A/B encoder.

The existing hqlab_v3_worker.py remains untouched and provides the H.264 old output.
This script is dispatched ONLY by the experimental hqlab-v3 workflow.
"""
import math
import tempfile
from pathlib import Path

from pyrogram import Client
import hqlab_v3_worker as old

# Decimal MB, so iPhone/Telegram file sizes stay at or below 10,000,000 bytes.
MAX_OUTPUT_BYTES = 10_000_000
TARGET_BYTES = 9_400_000
MAX_TEST_SECONDS = 60.0
AUDIO_KBPS = 112
VIDEO_KBPS_CAP = 10_000
MIN_TEST_VIDEO_KBPS = 650
QUALITY_SAMPLE_SECONDS = 3.0
MIN_SAMPLE_SSIM = 0.88


def budget_kbps(info):
    """Whole-file budget less audio and MP4 mux headroom."""
    duration = float(info["duration"])
    if duration <= 0:
        raise RuntimeError("Durasi video tidak sah")
    if duration > MAX_TEST_SECONDS:
        raise RuntimeError(
            "V3 HEVC Slow ujian maksimum 60s supaya 2-pass tidak melebihi masa worker. "
            "Potong klip 10–30 saat untuk perbandingan."
        )
    audio = AUDIO_KBPS if info["audio"] else 0
    rate = int(TARGET_BYTES * 8 / duration / 1000 - audio - 55)
    rate = min(VIDEO_KBPS_CAP, rate)
    if rate < MIN_TEST_VIDEO_KBPS:
        raise RuntimeError("Bitrate untuk 1080p60 terlalu rendah dalam 10 MB; cuba klip lebih pendek")
    return rate


def frame_box(info):
    w, h = info["width"], info["height"]
    if abs(w - h) / max(w, h) < 0.08:
        mw, mh = 1080, 1080
    elif w > h:
        mw, mh = 1920, 1080
    else:
        mw, mh = 1080, 1920
    fit = min(1.0, mw / w, mh / h)
    return (max(2, int(math.floor(w * fit / 2) * 2)),
            max(2, int(math.floor(h * fit / 2) * 2)))


def two_pass_encode(src, output, info, work, rate, attempt):
    width, height = frame_box(info)
    vf = f"scale={width}:{height}:flags=lanczos,setsar=1,fps=60"
    stats_path = str(work / f"hevc-v3-{attempt}.stats")
    x265_base = "log-level=error:pools=2:frame-threads=2"
    # libx265 two-pass uses x265 params pass=1/pass=2 and matching stats path.
    # x264's "-pass" is deliberately NOT used for H.265.
    video = [
        "-map", "0:v:0", "-vf", vf,
        "-c:v", "libx265", "-preset", "slow", "-pix_fmt", "yuv420p",
        "-tag:v", "hvc1", "-b:v", f"{rate}k",
        "-maxrate", f"{min(VIDEO_KBPS_CAP, int(rate * 1.05))}k",
        "-bufsize", f"{max(1000, rate * 2)}k", "-g", "120", "-threads", "2",
    ]
    prefix = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-i", str(src),
    ]
    pass_one = prefix + video + [
        "-x265-params", f"pass=1:stats={stats_path}:{x265_base}",
        "-an", "-f", "null", "/dev/null",
    ]
    old.run(pass_one, timeout=660)
    pass_two = prefix + video + [
        "-x265-params", f"pass=2:stats={stats_path}:{x265_base}",
    ]
    audio = (["-map", "0:a:0?", "-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k",
              "-ar", "48000", "-ac", "2"]
             if info["audio"] else ["-an"])
    old.run(pass_two + audio + [
        "-movflags", "+faststart", "-map_metadata", "-1",
        "-f", "mp4", str(output),
    ], timeout=660)
    return output.stat().st_size


def sample_ssim(src, output, info):
    """Short full-resolution sample check; not a guarantee of subjective quality.

    Compare encoded frames with the identical scaled, FPS-converted reference.
    Avoid a long extra decoding pass for the entire clip.
    """
    width, height = frame_box(info)
    result = old.run([
        "ffmpeg", "-hide_banner", "-nostdin", "-v", "info",
        "-t", str(min(QUALITY_SAMPLE_SECONDS, info["duration"])), "-i", str(src),
        "-t", str(min(QUALITY_SAMPLE_SECONDS, info["duration"])), "-i", str(output),
        "-filter_complex",
        f"[0:v]scale={width}:{height}:flags=lanczos,setsar=1,fps=60[ref];"
        "[ref][1:v]ssim",
        "-an", "-f", "null", "/dev/null",
    ], timeout=180)
    # old.run() returns stdout only; SSIM output lives in ffmpeg stderr.
    # Quality gate is instead implemented below using an isolated subprocess
    # that captures stderr without modifying the existing old worker.
    return result


def check_quality(src, output, info):
    import re
    import subprocess

    width, height = frame_box(info)
    secs = str(min(QUALITY_SAMPLE_SECONDS, float(info["duration"])))
    cmd = [
        "ffmpeg", "-hide_banner", "-nostdin", "-v", "info",
        "-t", secs, "-i", str(src), "-t", secs, "-i", str(output),
        "-filter_complex",
        f"[0:v]scale={width}:{height}:flags=lanczos,setsar=1,fps=60[ref];"
        "[ref][1:v]ssim", "-an", "-f", "null", "/dev/null",
    ]
    result = subprocess.run(cmd, text=True, capture_output=True, timeout=180)
    if result.returncode:
        raise RuntimeError("Tak dapat buat pemeriksaan SSIM: " + result.stderr[-450:])
    matches = re.findall(r"All:([0-9.]+)", result.stderr)
    if not matches:
        raise RuntimeError("FFmpeg SSIM tidak menghasilkan bacaan")
    value = float(matches[-1])
    print(f"V3 HEVC Slow sample SSIM={value:.5f} threshold={MIN_SAMPLE_SSIM}", flush=True)
    if value < MIN_SAMPLE_SSIM:
        raise RuntimeError(
            f"V3 HEVC kualiti belum lepas ujian (SSIM={value:.3f}). "
            "Video ini terlalu kompleks untuk 1080p60 dalam 10 MB; cuba klip lebih pendek."
        )
    return value


def encode(src, output, info, work):
    initial = budget_kbps(info)
    for attempt, ratio in enumerate((1.00, 0.94, 0.88), 1):
        rate = int(initial * ratio)
        if output.exists():
            output.unlink()
        size = two_pass_encode(src, output, info, work, rate, attempt)
        print(f"V3 HEVC Slow pass={attempt} video={rate} kbps bytes={size}", flush=True)
        if size <= MAX_OUTPUT_BYTES:
            result = old.probe(output)
            if result["fps"] != "60/1":
                raise RuntimeError("FPS output tidak 60: " + str(result["fps"]))
            if info["audio"] and not result["audio"]:
                raise RuntimeError("Audio output hilang")
            if (result["width"], result["height"]) != frame_box(info):
                raise RuntimeError("Dimensi output tidak sepadan dengan target")
            ssim = check_quality(src, output, info)
            return size, rate, result, ssim
    raise RuntimeError(
        "V3 HEVC Slow melebihi 10 MB selepas tiga percubaan selamat. "
        "Formula tidak akan turunkan bitrate secara agresif; cuba klip lebih pendek."
    )


def main():
    if not old.BOT_TOKEN or not old.API_ID or not old.API_HASH or not old.FILE_ID:
        raise RuntimeError("Konfigurasi worker eksperimen tidak lengkap")
    if not old.CHAT_ID or old.CHAT_ID != old.USER_ID:
        raise RuntimeError("HQ Lab HEVC hanya untuk owner dalam private chat")
    if old.SIZE > old.MAX_SOURCE:
        raise RuntimeError("Input Document melebihi 500 MiB")
    old.notify("🧪 Premium+ HQ V3 HEVC Slow 2-pass sedang diuji (asing daripada V3 Old).")
    with tempfile.TemporaryDirectory(prefix="mediax-hqlab-hevc-") as workdir:
        work = Path(workdir)
        source = work / "source.bin"
        result_file = work / "premium-v3-hevc-slow.mp4"
        client = Client("hqlab_v3_hevc_owner", api_id=old.API_ID,
                        api_hash=old.API_HASH, bot_token=old.BOT_TOKEN, in_memory=True)
        with client:
            downloaded = client.download_media(old.FILE_ID, file_name=str(source))
        if not downloaded or not source.is_file():
            raise RuntimeError("Download Document melalui MTProto gagal")
        if source.stat().st_size > old.MAX_SOURCE:
            raise RuntimeError("Document lebih 500 MiB")
        info = old.probe(source)
        size, kbps, result, ssim = encode(source, result_file, info, work)
        caption = (
            "🧪 Premium+ HQ V3 NEW — HEVC Slow 2-pass\n"
            f"📐 {result['width']} × {result['height']} • 60 FPS\n"
            f"📊 Target video bitrate: {kbps} kbps (maks 10,000)\n"
            f"📦 Saiz: {size / 1_000_000:.2f} MB / 10 MB\n"
            f"🔍 Sample SSIM: {ssim:.3f}\n"
            "📎 Original encoded MP4 sebagai Document.\n"
            "Production Premium+ HQ tidak berubah."
        )
        with result_file.open("rb") as handle:
            old.telegram("sendDocument",
                         {"chat_id": str(old.CHAT_ID), "caption": caption},
                         {"document": ("Premium-HQ-V3-HEVC-Slow.mp4", handle, "video/mp4")},
                         timeout=300)
    print("V3 HEVC Slow output delivered", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("V3 HEVC Slow failed:", exc, flush=True)
        old.notify("❌ HQ Lab V3 HEVC Slow gagal: " + str(exc)[:270])
        raise
