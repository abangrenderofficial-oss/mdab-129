"""Isolated, full-length MediaX benchmark: original 2 threads vs 4 threads.
No Telegram delivery, no changes to production MediaX encoders.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from mediax_oversize_social_worker import download_stream, probe, MAX_BYTES

def benchmark_encode(source, dest, duration, width, height, threads):
    # Identical FFmpeg arguments to production scripts/mediax_oversize_social_worker.py,
    # including target size, lanczos scale, profile, audio, SAR, DAR, rate control.
    # ONLY the -threads value and output filepath differ between runs.
    safety = 0.82
    target_bytes = math.floor(MAX_BYTES * safety)
    audio_kbps = 96 if duration > 600 else 128
    total_kbps = math.floor(target_bytes * 8 / duration / 1000)
    video_kbps = total_kbps - audio_kbps - 32
    desired = 1920 if video_kbps >= 2200 else 1280 if video_kbps >= 1000 else 854
    dimension = min(max(width, height), desired)
    max_rate = max(video_kbps, math.floor(video_kbps * 1.08))
    bufsize = max(video_kbps * 2, 1000)
    scale = (f"scale={dimension}:{dimension}:"
             "force_original_aspect_ratio=decrease:"
             "force_divisible_by=2:flags=lanczos")
    args = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-nostats",
        "-nostdin", "-i", str(source), "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", scale + ",setsar=1", "-c:v", "libx264",
        "-threads", str(threads), "-preset", "veryfast",
        "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-aspect", f"{width}:{height}",
        "-b:v", f"{video_kbps}k", "-maxrate", f"{max_rate}k",
        "-bufsize", f"{bufsize}k", "-c:a", "aac", "-b:a", f"{audio_kbps}k",
        "-ac", "2", "-movflags", "+faststart", "-map_metadata", "-1",
        "-metadata:s:v:0", "rotate=0", str(dest),
    ]
    print("BENCHMARK_START", json.dumps({
        "threads": threads, "source_width": width, "source_height": height,
        "duration_seconds": duration, "video_kbps": video_kbps,
        "preset": "veryfast", "safety": safety
    }), flush=True)
    started = time.perf_counter()
    result = subprocess.run(args, capture_output=True, text=True, timeout=650)
    seconds = time.perf_counter() - started
    if result.returncode:
        raise RuntimeError(
            f"ffmpeg {threads} threads failed, code {result.returncode}: "
            + (result.stderr or "")[-900:])
    probe_run = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,codec_name,pix_fmt,avg_frame_rate,sample_aspect_ratio,display_aspect_ratio,bit_rate",
         "-of", "json", str(dest)], capture_output=True, text=True, check=True, timeout=30)
    stream = (json.loads(probe_run.stdout).get("streams") or [{}])[0]
    if int(stream.get("width", 0)) != width or int(stream.get("height", 0)) != height:
        raise RuntimeError("Output dimensions did not preserve 9:16")
    if stream.get("avg_frame_rate") != "60/1":
        raise RuntimeError(f"Output FPS changed: {stream.get('avg_frame_rate')}")
    if stream.get("pix_fmt") != "yuv420p":
        raise RuntimeError("Video pixel format changed")
    bytes_out = dest.stat().st_size
    if bytes_out > MAX_BYTES:
        raise RuntimeError(f"Encoded {threads}-threads video exceeds 50MB upload limit")
    entry = {
        "threads": threads, "encode_seconds": round(seconds, 3),
        "output_bytes": bytes_out, "output_mb_decimal": round(bytes_out / 1e6, 3),
        "width": int(stream["width"]), "height": int(stream["height"]),
        "fps": stream["avg_frame_rate"], "codec": stream["codec_name"],
        "pix_fmt": stream["pix_fmt"],
        "sample_aspect_ratio": stream.get("sample_aspect_ratio"),
        "display_aspect_ratio": stream.get("display_aspect_ratio"),
        "video_bitrate": stream.get("bit_rate"),
    }
    print("BENCHMARK_RESULT", json.dumps(entry, sort_keys=True), flush=True)
    return entry

def main():
    if not os.environ.get("SOCIAL_STREAM_URL"):
        raise RuntimeError("One-time Bot Hosting source stream URL is required")
    print("BENCHMARK_RUNNER", json.dumps({
        "cpu_count": os.cpu_count(), "platform": sys.platform,
        "ffmpeg_version": subprocess.run(
            ["ffmpeg", "-version"], capture_output=True, text=True).stdout.splitlines()[0],
    }), flush=True)
    with tempfile.TemporaryDirectory(prefix="mediax-bench-") as folder:
        root = Path(folder)
        begin = time.perf_counter()
        source = download_stream(root)
        transfer_seconds = round(time.perf_counter() - begin, 3)
        size = source.stat().st_size
        duration, width, height = probe(source)
        if size < 100_000_000:
            raise RuntimeError("Benchmark must use full original oversized TikTok video")
        print("BENCHMARK_SOURCE", json.dumps({
            "source_bytes": size, "transfer_seconds": transfer_seconds,
            "width": width, "height": height, "duration_seconds": duration,
        }), flush=True)
        results = []
        for threads in (2, 4):
            dest = root / f"output-{threads}threads.mp4"
            results.append(benchmark_encode(source, dest, duration, width, height, threads))
            dest.unlink()
        a, b = results
        summary = {
            "source_bytes": size,
            "source_duration_seconds": duration,
            "transfer_seconds": transfer_seconds,
            "two_thread_seconds": a["encode_seconds"],
            "four_thread_seconds": b["encode_seconds"],
            "speedup": round(a["encode_seconds"] / b["encode_seconds"], 3),
            "encoding_time_saved_seconds": round(a["encode_seconds"] - b["encode_seconds"], 3),
            "output_size_difference_bytes": b["output_bytes"] - a["output_bytes"],
            "same_output_dimensions": a["width"] == b["width"] and a["height"] == b["height"],
            "same_output_fps": a["fps"] == b["fps"],
            "runner_cpus": os.cpu_count(),
            "production_codec_settings_changed": False,
        }
        print("BENCHMARK_SUMMARY", json.dumps(summary, sort_keys=True), flush=True)
        Path("mediax-benchmark-result.json").write_text(json.dumps({
            "source": summary, "results": results,
        }, indent=2), encoding="utf-8")

if __name__ == "__main__":
    try: main()
    except Exception as error:
        print("BENCHMARK_FAILED", str(error)[:1200], file=sys.stderr, flush=True)
        sys.exit(1)
