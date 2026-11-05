"""MediaX owner-only HQ Lab: V3 QUALITY FIRST (HEVC slow, CRF18).

Experimental alternative to V3 OLD H.264. No production encoders are imported
or modified. No arbitrary 10 MB ceiling, no forced 60 fps, no two-pass bitrate
target. Actual progress and estimated remaining encoding time are reported
in the owner's private Telegram chat.
"""
import math
import os
import subprocess
import tempfile
import time
from fractions import Fraction
from pathlib import Path

from pyrogram import Client
import hqlab_v3_worker as old

CRF = 18
PRESET = "slow"
AUDIO_KBPS = 128
MAX_OUTPUT_BYTES = 1950 * 1024 * 1024
ENCODE_TIMEOUT_SECONDS = 50 * 60
PROGRESS_INTERVAL_SECONDS = 20


def frame_box(info):
    width, height = info["width"], info["height"]
    if abs(width - height) / max(width, height) < 0.08:
        max_w, max_h = 1080, 1080
    elif width > height:
        max_w, max_h = 1920, 1080
    else:
        max_w, max_h = 1080, 1920
    fit = min(1.0, max_w / width, max_h / height)
    return (max(2, int(math.floor(width * fit / 2) * 2)),
            max(2, int(math.floor(height * fit / 2) * 2)))


def human_duration(seconds):
    if seconds is None or not math.isfinite(seconds):
        return "Calculating..."
    seconds = max(0, int(math.ceil(seconds)))
    if seconds < 60:
        return "Less than 1 minute"
    minutes = int(math.ceil(seconds / 60))
    if minutes < 60:
        return f"Approximately {minutes} min"
    return f"Approximately {minutes // 60} hr {minutes % 60} min"


def source_fps(info):
    try:
        value = float(Fraction(str(info.get("fps") or "0/1")))
        return value if 0 < value < 241 else None
    except (ValueError, TypeError, ZeroDivisionError):
        return None


def progress_text(percent=None, remaining=None):
    heading = "✨ Premium+ HQ is Processing Your Video..."
    note = ("Your high-resolution video requires extra processing time "
            "to preserve the best possible quality.")
    lines = [heading, "", note, ""]
    if percent is not None:
        lines.append(f"🎞 Encoding progress: {percent:.0f}%")
    lines.append(f"⏳ Estimated Time: {human_duration(remaining)}")
    lines.append("")
    lines.append("Please wait while we optimize your video. 🎬")
    return "\n".join(lines)


def eta_from_progress(source_seconds, elapsed, duration):
    if elapsed < 5 or source_seconds <= 0 or duration <= 0:
        return None
    speed = source_seconds / elapsed
    if not math.isfinite(speed) or speed <= 0.0001:
        return None
    return max(0, (duration - source_seconds) / speed)


def parse_ffmpeg_time(line):
    key, _, value = line.partition("=")
    if key == "out_time_us" or key == "out_time_ms":
        # ffmpeg's out_time_ms field is (historically) microseconds.
        try:
            return max(0.0, int(value) / 1_000_000)
        except ValueError:
            return None
    if key == "out_time":
        try:
            hours, minutes, seconds = value.split(":")
            return max(0.0, float(hours) * 3600 + float(minutes) * 60 + float(seconds))
        except (ValueError, TypeError):
            return None
    return None


def progress_reporter(message_id, update_text=old.telegram):
    def publish(percent=None, remaining=None):
        if not message_id:
            return
        try:
            update_text("editMessageText", {
                "chat_id": str(old.CHAT_ID),
                "message_id": str(message_id),
                "text": progress_text(percent, remaining),
            }, timeout=30)
        except Exception as exc:
            print(f"V3 Quality First progress update skipped: {exc}", flush=True)
    return publish


def ffmpeg_args(src, dest, info):
    width, height = frame_box(info)
    filters = f"scale={width}:{height}:flags=lanczos,setsar=1"
    args = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-nostdin", "-nostats", "-stats_period", "2", "-progress", "pipe:1",
        "-i", str(src),
        "-map", "0:v:0",
    ]
    if info["audio"]:
        args += ["-map", "0:a:0?"]
    args += [
        "-vf", filters,
        "-c:v", "libx265", "-preset", PRESET, "-crf", str(CRF),
        "-pix_fmt", "yuv420p", "-tag:v", "hvc1",
        "-x265-params", "log-level=error:pools=2:frame-threads=2",
    ]
    if info["audio"]:
        args += ["-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k", "-ar", "48000", "-ac", "2"]
    else:
        args += ["-an"]
    args += [
        "-fps_mode", "passthrough",
        "-movflags", "+faststart", "-map_metadata", "-1",
        "-f", "mp4", str(dest),
    ]
    return args


def encode(src, output, info, on_progress=None):
    if output.exists():
        output.unlink()
    command = ffmpeg_args(src, output, info)
    started = time.monotonic()
    last_update = started - PROGRESS_INTERVAL_SECONDS
    encoded_seconds = 0.0
    # File-backed stderr avoids deadlocking if FFmpeg logs grow.
    with tempfile.TemporaryFile(mode="w+t") as errors:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=errors,
            text=True,
            bufsize=1,
        )
        try:
            for line in process.stdout:
                line = line.strip()
                position = parse_ffmpeg_time(line)
                if position is not None:
                    encoded_seconds = max(encoded_seconds, position)
                now = time.monotonic()
                if now - started > ENCODE_TIMEOUT_SECONDS:
                    process.kill()
                    raise RuntimeError("Quality First encoding exceeded 50 minutes.")
                if on_progress and (line == "progress=end" or now - last_update >= PROGRESS_INTERVAL_SECONDS):
                    complete = min(99, 100 * encoded_seconds / max(info["duration"], 0.001))
                    eta = eta_from_progress(encoded_seconds, now - started, info["duration"])
                    on_progress(complete, eta)
                    last_update = now
            code = process.wait(timeout=30)
            if code:
                errors.seek(0)
                raise RuntimeError("Quality First FFmpeg error: " + errors.read()[-1200:])
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=15)
    if not output.is_file() or output.stat().st_size <= 0:
        raise RuntimeError("Quality First did not produce an MP4 output.")
    size = output.stat().st_size
    if size > MAX_OUTPUT_BYTES:
        raise RuntimeError(
            "Quality First output exceeds the 1.9 GiB Telegram document limit. "
            "Shorten your source video."
        )
    final = old.probe(output)
    if (final["width"], final["height"]) != frame_box(info):
        raise RuntimeError("Output dimensions do not match the source aspect ratio.")
    if info["audio"] and not final["audio"]:
        raise RuntimeError("Source audio was lost during encoding.")
    incoming = source_fps(info)
    outgoing = source_fps(final)
    if incoming is not None and outgoing is not None and abs(incoming - outgoing) > 0.6:
        raise RuntimeError(
            f"Source frame rate was not preserved ({incoming:.2f} -> {outgoing:.2f})."
        )
    return size, final


def main():
    if not old.BOT_TOKEN or not old.API_ID or not old.API_HASH or not old.FILE_ID:
        raise RuntimeError("Missing owner-only V3 worker configuration.")
    if old.CHAT_ID <= 0 or old.CHAT_ID != old.USER_ID:
        raise RuntimeError("This test can only run in the owner's private chat.")
    if old.SIZE > old.MAX_SOURCE:
        raise RuntimeError("Input document exceeds 500 MiB.")
    message_id = None
    try:
        message = old.telegram("sendMessage", {
            "chat_id": str(old.CHAT_ID),
            "text": progress_text(),
        }, timeout=30)
        message_id = message.get("message_id") if message else None
    except Exception as exc:
        print(f"V3 Quality First initial progress unavailable: {exc}", flush=True)

    try:
        with tempfile.TemporaryDirectory(prefix="mediax-hqlab-quality-first-") as directory:
            work = Path(directory)
            source = work / "source.bin"
            target = work / "Premium-HQ-V3-Quality-First.mp4"
            # Keep MTProto session alive to upload large outputs (> 50MB Bot API limit).
            with Client("hqlab_v3_quality_owner", api_id=old.API_ID,
                        api_hash=old.API_HASH, bot_token=old.BOT_TOKEN, in_memory=True) as client:
                fetched = client.download_media(old.FILE_ID, file_name=str(source))
                if not fetched or not source.is_file():
                    raise RuntimeError("MTProto could not download the video document.")
                if source.stat().st_size > old.MAX_SOURCE:
                    raise RuntimeError("Input document exceeds 500 MiB.")

                info = old.probe(source)
                print(f"V3 Quality First source={info}", flush=True)
                publish = progress_reporter(message_id)
                size, result = encode(source, target, info, on_progress=publish)
                if message_id:
                    try:
                        old.telegram("editMessageText", {
                            "chat_id": str(old.CHAT_ID),
                            "message_id": str(message_id),
                            "text": "✅ Encoding complete. Uploading your HQ video as a Document...",
                        }, timeout=30)
                    except Exception:
                        pass
                fps = source_fps(result)
                caption = (
                    "🧪 Premium+ HQ V3 — QUALITY FIRST\n"
                    f"📐 {result['width']} × {result['height']}\n"
                    f"🎞 Source FPS preserved: {fps:.2f}\n" if fps is not None else
                    "🧪 Premium+ HQ V3 — QUALITY FIRST\n"
                    f"📐 {result['width']} × {result['height']}\n"
                    "🎞 Source FPS preserved\n"
                )
                caption += (
                    "🎬 HEVC / H.265 • Slow • CRF 18\n"
                    f"📦 Output size: {size / (1024 * 1024):.2f} MiB (quality-first, no 10 MB cap)\n"
                    "📎 Sent as MP4 Document. Experimental HQ Lab only.\n"
                    "Production Premium+ HQ unchanged."
                )
                client.send_document(old.CHAT_ID, str(target), caption=caption)
        if message_id:
            try:
                old.telegram("deleteMessage", {
                    "chat_id": str(old.CHAT_ID),
                    "message_id": str(message_id),
                }, timeout=30)
            except Exception:
                pass
        print("V3 Quality First MP4 uploaded successfully", flush=True)
    except Exception as exc:
        print(f"V3 Quality First error: {exc}", flush=True)
        old.notify("❌ Premium+ HQ V3 Quality First failed: " + str(exc)[:260])
        raise


if __name__ == "__main__":
    main()
