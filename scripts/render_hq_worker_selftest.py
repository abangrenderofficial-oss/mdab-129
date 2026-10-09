"""Offline 2-second Status HQ worker codec/audio regression — no Telegram traffic."""
import importlib
import json
import subprocess
import tempfile
from pathlib import Path

worker = importlib.import_module("heavy_status_worker")


def probe_streams(path):
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,codec_name,pix_fmt", "-of", "json", str(path)],
        check=True, capture_output=True, text=True, timeout=30,
    )
    return json.loads(p.stdout).get("streams", [])


def run_case(directory, with_audio):
    name = "audio" if with_audio else "silent"
    source = directory / f"{name}-source.mp4"
    output = directory / f"{name}-hq.mp4"
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15",
    ]
    if with_audio:
        cmd.extend(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"])
    cmd.extend(["-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"])
    if with_audio:
        cmd.extend(["-c:a", "aac", "-b:a", "96k"])
    else:
        cmd.append("-an")
    cmd.append(str(source))
    subprocess.run(cmd, check=True, timeout=45, capture_output=True)
    parsed = worker.probe_video(source)
    worker.encode_status(source, output, parsed)
    worker.validate_premium_status_output(source, output)
    streams = probe_streams(output)
    assert any(s.get("codec_type") == "video" and s.get("codec_name") == "hevc" for s in streams)
    has_audio = any(s.get("codec_type") == "audio" and s.get("codec_name") == "aac" for s in streams)
    assert has_audio is with_audio, f"{name}: wrong audio state"
    assert output.stat().st_size < 47 * worker.MB
    print("RENDER_HQ_WORKER_SELFTEST_OK", json.dumps({
        "case": name, "audio": has_audio, "bytes": output.stat().st_size
    }), flush=True)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="render-hq-worker-test-") as temp:
        directory = Path(temp)
        run_case(directory, True)
        run_case(directory, False)
