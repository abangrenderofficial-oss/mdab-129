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

    # Exercise the real send_status_video() serialization while replacing the
    # network transport. This proves the worker builds a sendVideo request,
    # supplies a readable MP4 and preserves its audio; no Telegram API called.
    previous_call, previous_chat = worker.telegram_call, worker.CHAT_ID
    uploads = []
    try:
        worker.CHAT_ID = 123456789
        def fake_telegram_call(method, data=None, files=None, timeout=180):
            if method == 'getMe':
                return {'username': 'offline_test_bot'}
            assert method == 'sendVideo', 'Only sendVideo is expected in this test'
            assert data['chat_id'] == '123456789'
            assert data['supports_streaming'] == 'true'
            assert 'status-hq.mp4' == files['video'][0]
            assert files['video'][2] == 'video/mp4'
            assert files['video'][1].read(24), 'Video upload stream is empty'
            uploads.append((method, int(data['width']), int(data['height'])))
            return {'message_id': 1}
        worker.telegram_call = fake_telegram_call
        worker.send_status_video(output)
        assert uploads and uploads[0][0] == 'sendVideo'
        def failing_telegram_call(method, data=None, files=None, timeout=180):
            if method == 'getMe':
                return {'username': 'offline_test_bot'}
            raise RuntimeError('simulated Telegram HTTP 500')
        worker.telegram_call = failing_telegram_call
        try:
            worker.send_status_video(output)
        except RuntimeError as error:
            assert 'simulated Telegram HTTP 500' in str(error)
        else:
            raise AssertionError('Telegram send failure must propagate to prevent success callback')
    finally:
        worker.telegram_call = previous_call
        worker.CHAT_ID = previous_chat
    print('RENDER_HQ_TELEGRAM_UPLOAD_MOCK_OK', json.dumps({'case': name, 'sendVideoCalls':len(uploads)}))
    print("RENDER_HQ_WORKER_SELFTEST_OK", json.dumps({
        "case": name, "audio": has_audio, "bytes": output.stat().st_size
    }), flush=True)


def test_url_source_routing(directory):
    assert worker.allowed_source_url('https://vt.tiktok.com/ZSqqYxc13/')
    assert worker.allowed_source_url('https://www.youtube.com/watch?v=Ftffph3fVEs')
    assert not worker.allowed_source_url('http://vt.tiktok.com/test')
    assert not worker.allowed_source_url('https://localhost/private')
    assert not worker.allowed_source_url('https://youtube.com.evil.org/test')
    assert not worker.allowed_source_url('file:///etc/passwd')

    from types import SimpleNamespace
    path = directory / 'source-url-worker.bin'
    output = directory / 'source-social.mp4'
    output.write_bytes(b'synthetic-video-test-bytes')
    prev_url, prev_run, prev_progress = worker.SOURCE_URL, worker.run, worker.set_progress
    prev_provider = worker.download_tikwm_source
    assert not worker.allowed_provider_media_url('http://127.0.0.1/admin')
    assert not worker.allowed_provider_media_url('http://169.254.169.254/latest/meta-data')
    assert worker.allowed_provider_media_url('https://v16.tiktokcdn.com/video.mp4')
    called = []
    try:
        worker.SOURCE_URL = 'https://vt.tiktok.com/ZSqqYxc13/'
        def fake_run(cmd, timeout=0):
            called.append((cmd, timeout))
            assert '--' in cmd and cmd[-1] == worker.SOURCE_URL
            assert '-m' in cmd and 'yt_dlp' in cmd
            return SimpleNamespace(stdout=str(output) + '\\n')
        worker.run = fake_run
        worker.set_progress = lambda _value: None
        def mock_provider_failure(_path):
            raise RuntimeError('mocked provider failure (no network)')
        worker.download_tikwm_source = mock_provider_failure
        worker.download_public_social_source(path)
        assert path.read_bytes() == b'synthetic-video-test-bytes'
        assert called and called[0][1] == 420
        # TikWM success should avoid yt-dlp entirely.
        worker.download_tikwm_source = lambda dst: dst.write_bytes(b'synthetic-provider-media-bytes')
        called.clear()
        path.unlink()
        worker.download_public_social_source(path)
        assert path.read_bytes() == b'synthetic-provider-media-bytes'
        assert not called
        print('RENDER_HQ_URL_WORKER_SELFTEST_OK — URL validation, provider-first and yt-dlp fallback, all mocked')
    finally:
        worker.SOURCE_URL, worker.run, worker.set_progress = prev_url, prev_run, prev_progress
        worker.download_tikwm_source = prev_provider


def test_manual_private_delivery_guard(directory):
    # Reuses the real synthetic source path with mocked getChat; no Bot API
    # request is sent. A group destination must fail closed before generating.
    original = (worker.SOURCE_KIND, worker.SOURCE_URL, worker.VIDEO_FILE_ID,
                worker.CHAT_ID, worker.telegram_call, worker.set_progress)
    source = directory / 'synthetic-private-source.bin'
    attempts = []
    try:
        worker.SOURCE_KIND = 'manual_synthetic'
        worker.SOURCE_URL = ''
        worker.VIDEO_FILE_ID = 'SYNTHETIC_TEST_ONLY'
        worker.CHAT_ID = 555
        worker.set_progress = lambda _value: None
        def mock_get_chat(method, data=None, files=None, timeout=20):
            attempts.append(method)
            assert method == 'getChat'
            assert data['chat_id'] == '555'
            return {'id': 555, 'type': 'private'}
        worker.telegram_call = mock_get_chat
        worker.download_source(source)
        result = worker.probe_video(source)
        assert result['duration'] >= 1.5 and attempts == ['getChat']
        worker.telegram_call = lambda *_args, **_kwargs: {'id': -100555, 'type': 'supergroup'}
        try:
            worker.download_source(directory / 'must-not-create.bin')
        except RuntimeError as error:
            assert 'private Telegram chat' in str(error)
        else:
            raise AssertionError('Synthetic HQ must never send to group chats')
        assert not (directory / 'must-not-create.bin').exists()
        print('RENDER_HQ_MANUAL_PRIVATE_GUARD_OK — 2s synthetic source and no group chats')
    finally:
        (worker.SOURCE_KIND, worker.SOURCE_URL, worker.VIDEO_FILE_ID,
         worker.CHAT_ID, worker.telegram_call, worker.set_progress) = original


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="render-hq-worker-test-") as temp:
        directory = Path(temp)
        test_url_source_routing(directory)
        test_manual_private_delivery_guard(directory)
        run_case(directory, True)
        run_case(directory, False)
