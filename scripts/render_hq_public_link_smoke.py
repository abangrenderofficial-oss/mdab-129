"""Non-Telegram public TikTok -> real HQ worker performance smoke on GitHub runner."""
import json
import subprocess
import tempfile
import time
from pathlib import Path
import heavy_status_worker as worker

SAMPLE = 'https://vt.tiktok.com/ZSqqYxc13/'


def main():
    started = time.monotonic()
    previous_url = worker.SOURCE_URL
    previous_progress = worker.set_progress
    previous_run = worker.run
    try:
        with tempfile.TemporaryDirectory(prefix='render-hq-public-test-') as directory:
            directory = Path(directory)
            raw = directory / 'public-source.bin'
            short = directory / 'public-clip.mp4'
            output = directory / 'public-hq.mp4'
            worker.SOURCE_URL = SAMPLE
            worker.set_progress = lambda _value: None
            def limited_run(cmd, timeout=900):
                if 'yt_dlp' in cmd:
                    return previous_run(cmd, timeout=110)
                return previous_run(cmd, timeout=timeout)
            worker.run = limited_run
            worker.download_public_social_source(raw)
            downloaded = time.monotonic()
            subprocess.run(
                ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                 '-i', str(raw), '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast',
                 '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(short)],
                check=True, capture_output=True, timeout=50)
            metadata = worker.probe_video(short)
            worker.encode_status(short, output, metadata)
            worker.validate_premium_status_output(short, output)
            print('RENDER_HQ_PUBLIC_LINK_SMOKE ' + json.dumps({
                'ok': True,
                'sourceDownloadSeconds': round(downloaded-started, 1),
                'totalSeconds': round(time.monotonic()-started, 1),
                'sourceBytes': raw.stat().st_size,
                'hqBytes': output.stat().st_size,
                'hqDurationSeconds': round(metadata['duration'], 1),
            }), flush=True)
    except Exception as error:
        print('RENDER_HQ_PUBLIC_LINK_SMOKE ' + json.dumps({
            'ok': False, 'errorClass': type(error).__name__,
            'elapsedSeconds': round(time.monotonic()-started, 1),
        }), flush=True)
        raise
    finally:
        worker.SOURCE_URL = previous_url
        worker.set_progress = previous_progress
        worker.run = previous_run


if __name__ == '__main__':
    main()
