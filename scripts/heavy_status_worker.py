import json
import math
import os
import subprocess
import tempfile
import shutil
import sys
from urllib.parse import urlparse, urljoin
import ipaddress
from pathlib import Path

import requests
from pyrogram import Client

MB = 1024 * 1024
BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '').strip()
API_ID = int(os.environ.get('TELEGRAM_API_ID', '0') or 0)
API_HASH = os.environ.get('TELEGRAM_API_HASH', '').strip()
CHAT_ID = int(os.environ.get('HEAVY_CHAT_ID', '0') or 0)
VIDEO_FILE_ID = os.environ.get('HEAVY_VIDEO_FILE_ID', '').strip()
SOURCE_URL = os.environ.get('HEAVY_SOURCE_URL', '').strip()
FILE_SIZE = int(os.environ.get('HEAVY_FILE_SIZE', '0') or 0)
ACTION = os.environ.get('HEAVY_ACTION', 'status_hq').strip() or 'status_hq'
PROGRESS_MESSAGE_ID = int(os.environ.get('HEAVY_PROGRESS_MESSAGE_ID', '0') or 0)
SOURCE_MESSAGE_ID = int(os.environ.get('HEAVY_SOURCE_MESSAGE_ID', '0') or 0)
MAX_INPUT_MB = int(os.environ.get('HEAVY_VIDEO_MAX_MB', '250') or 250)
MAX_INPUT_BYTES = MAX_INPUT_MB * MB
BOT_API_BASE = os.environ.get('TELEGRAM_API_BASE_URL', 'https://api.telegram.org').rstrip('/')


def allowed_source_url(url):
    try:
        parsed = urlparse(str(url or ''))
        host = (parsed.hostname or '').lower()
        trusted = ('tiktok.com', 'instagram.com', 'threads.com', 'threads.net',
                   'youtube.com', 'youtu.be', 'twitter.com', 'x.com')
        return (parsed.scheme == 'https' and not parsed.username and
                not parsed.password and parsed.port is None and len(url) <= 1500 and
                any(host == d or host.endswith('.' + d) for d in trusted))
    except (ValueError, TypeError):
        return False


def require_config():
    missing = []
    if not BOT_TOKEN:
        missing.append('TELEGRAM_BOT_TOKEN')
    if not API_ID:
        missing.append('TELEGRAM_API_ID')
    if not API_HASH:
        missing.append('TELEGRAM_API_HASH')
    if not CHAT_ID:
        missing.append('HEAVY_CHAT_ID')
    if not VIDEO_FILE_ID and not SOURCE_URL:
        missing.append('HEAVY_VIDEO_FILE_ID or HEAVY_SOURCE_URL')
    if SOURCE_URL and not allowed_source_url(SOURCE_URL):
        raise RuntimeError('Unsupported source URL for heavy worker')
    if missing:
        raise RuntimeError('Missing required configuration: ' + ', '.join(missing))
    if FILE_SIZE > MAX_INPUT_BYTES:
        raise RuntimeError(f'Video exceeds {MAX_INPUT_MB}MB heavy-media limit.')


def telegram_call(method, data=None, files=None, timeout=180):
    response = requests.post(
        f'{BOT_API_BASE}/bot{BOT_TOKEN}/{method}',
        data=data or {},
        files=files,
        timeout=timeout,
    )
    try:
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f'Telegram {method} returned HTTP {response.status_code}') from exc
    if not response.ok or not payload.get('ok'):
        raise RuntimeError(payload.get('description') or f'Telegram {method} failed ({response.status_code})')
    return payload.get('result')


def status_caption():
    try:
        me = telegram_call('getMe', timeout=30) or {}
        username = str(me.get('username') or '').strip().lstrip('@')
        if username:
            return f'Video Ready For Status ✅\nDownload In @{username}'
    except Exception as exc:
        print(f'bot username lookup failed: {exc}', flush=True)
    return 'Video Ready For Status ✅'


def progress_text(percent):
    value = max(1, min(100, int(round(percent))))
    filled = 10 if value >= 100 else min(9, value // 10)
    bar = '▰' * filled + '▱' * (10 - filled)
    title = 'Your Video Is Ready ✅' if value >= 100 else 'Your Video Is on Its Way...'
    return f'{title}\n\n{bar} {value}% 🔋'


def set_progress(percent):
    if not PROGRESS_MESSAGE_ID:
        return
    try:
        telegram_call(
            'editMessageText',
            {
                'chat_id': str(CHAT_ID),
                'message_id': str(PROGRESS_MESSAGE_ID),
                'text': progress_text(percent),
            },
            timeout=30,
        )
    except Exception as exc:
        print(f'progress update failed: {exc}', flush=True)


def finish_progress():
    if not PROGRESS_MESSAGE_ID:
        return
    try:
        telegram_call(
            'deleteMessage',
            {'chat_id': str(CHAT_ID), 'message_id': str(PROGRESS_MESSAGE_ID)},
            timeout=30,
        )
    except Exception as exc:
        print(f'progress delete failed: {exc}', flush=True)


def fail_progress(message):
    text = f'❌ {message}'[:4096]
    if PROGRESS_MESSAGE_ID:
        try:
            telegram_call(
                'editMessageText',
                {'chat_id': str(CHAT_ID), 'message_id': str(PROGRESS_MESSAGE_ID), 'text': text},
                timeout=30,
            )
            return
        except Exception:
            pass
    try:
        telegram_call('sendMessage', {'chat_id': str(CHAT_ID), 'text': text}, timeout=30)
    except Exception:
        pass


def run(cmd, timeout=900):
    print('$ ' + ' '.join(str(x) for x in cmd), flush=True)
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)


def probe_video(path):
    result = run(
        [
            'ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_entries',
            'stream=width,height,r_frame_rate,color_range,color_space,color_transfer,color_primaries:format=duration',
            '-of', 'json', str(path),
        ],
        timeout=60,
    )
    payload = json.loads(result.stdout or '{}')
    streams = payload.get('streams') or []
    stream = streams[0] if streams else {}
    duration = float((payload.get('format') or {}).get('duration') or 0)
    width = int(stream.get('width') or 0)
    height = int(stream.get('height') or 0)
    if duration <= 0:
        raise RuntimeError('Tak dapat baca duration video.')
    return {
        'duration': duration,
        'width': width,
        'height': height,
        'color_range': str(stream.get('color_range') or ''),
        'color_space': str(stream.get('color_space') or ''),
        'color_transfer': str(stream.get('color_transfer') or ''),
        'color_primaries': str(stream.get('color_primaries') or ''),
    }


def even_floor(value):
    return max(2, int(math.floor(value / 2.0) * 2))


def target_dimensions(width, height, video_kbps, live=False):
    if not width or not height:
        return None
    if live:
        max_w, max_h = ((1920, 1080) if width > height else (1080, 1920))
    else:
        if video_kbps >= 2400:
            tier = 1080
        elif video_kbps >= 1050:
            tier = 720
        elif video_kbps >= 650:
            tier = 540
        else:
            tier = 360
        if abs(width - height) / max(width, height) < 0.08:
            max_w, max_h = tier, tier
        elif width > height:
            max_w, max_h = {1080: (1920, 1080), 720: (1280, 720), 540: (960, 540), 360: (640, 360)}[tier]
        else:
            max_w, max_h = {1080: (1080, 1920), 720: (720, 1280), 540: (540, 960), 360: (360, 640)}[tier]
    scale = min(1.0, max_w / width, max_h / height)
    return even_floor(width * scale), even_floor(height * scale)


def status_plan(probe, android=False):
    duration = max(1.0, probe['duration'])
    target_bytes = int(43.5 * MB)
    audio_kbps = 128
    total_kbps = int((target_bytes * 8 / duration / 1000) * 0.90)
    max_video_kbps = 2800 if android else 5000
    video_kbps = max(220, min(max_video_kbps, total_kbps - audio_kbps - 70))
    return {
        'video_kbps': video_kbps,
        'audio_kbps': audio_kbps,
        'tier': 720,
        'android': android,
    }


def status_scale_filter(tier, android=False):
    if android:
        landscape_w, landscape_h = 1280, 720
        portrait_w, portrait_h = 720, 1280
    elif tier == 720:
        landscape_w, landscape_h = 1280, 720
        portrait_w, portrait_h = 720, 1280
    elif tier == 540:
        landscape_w, landscape_h = 960, 540
        portrait_w, portrait_h = 540, 960
    else:
        landscape_w, landscape_h = 640, 360
        portrait_w, portrait_h = 360, 640

    max_w = f'if(gte(iw,ih),{landscape_w},{portrait_w})'
    max_h = f'if(gte(iw,ih),{landscape_h},{portrait_h})'
    fit = f'min(1,min(({max_w})/iw,({max_h})/ih))'
    return (
        f"scale=w='max(2,trunc(iw*{fit}/2)*2)':"
        f"h='max(2,trunc(ih*{fit}/2)*2)':flags=lanczos"
    )


def premium_v2_scale_filter(probe):
    width = int(probe.get('width') or 0)
    height = int(probe.get('height') or 0)
    squareish = width and height and abs(width - height) / max(width, height) < 0.08
    if squareish:
        max_w, max_h = 1280, 1280
    elif width > height:
        max_w, max_h = 1280, 720
    else:
        max_w, max_h = 720, 1280
    fit = f'min(1,min({max_w}/iw,{max_h}/ih))'
    return (
        f"scale=w='max(2,trunc(iw*{fit}/2)*2)':"
        f"h='max(2,trunc(ih*{fit}/2)*2)':flags=lanczos"
    )


def premium_v2_color_args(probe):
    transfer = str(probe.get('color_transfer') or '').lower()
    primaries = str(probe.get('color_primaries') or '').lower()
    bt2020 = 'bt2020' in primaries or 'bt2020' in str(probe.get('color_space') or '').lower()
    if bt2020 and transfer == 'arib-std-b67':
        return [
            '-color_range', 'tv', '-color_primaries', 'bt2020',
            '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc',
        ]
    if bt2020 and transfer == 'smpte2084':
        return [
            '-color_range', 'tv', '-color_primaries', 'bt2020',
            '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
        ]
    return [
        '-color_range', 'tv', '-color_primaries', 'bt709',
        '-color_trc', 'bt709', '-colorspace', 'bt709',
    ]


def encode_status(input_path, output_path, probe, android=False):
    plan = status_plan(probe, android=android)
    safe_limit = int(47 * MB)
    for index, bitrate_scale in enumerate((1.0, 0.84, 0.70), 1):
        if output_path.exists():
            output_path.unlink()
        video_kbps = max(180, int(plan['video_kbps'] * bitrate_scale))

        if android:
            maxrate = max(video_kbps, int(video_kbps * 1.12))
            bufsize = max(1000, maxrate * 2)
            filters = [status_scale_filter(plan['tier'], android=True), 'setsar=1', 'fps=30']
            cmd = [
                'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
                '-filter_threads', '1', '-i', str(input_path), '-map', '0:v:0', '-map', '0:a:0?',
                '-vf', ','.join(filters),
                '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
                '-b:v', f'{video_kbps}k', '-maxrate', f'{maxrate}k', '-bufsize', f'{bufsize}k',
                '-profile:v', 'high', '-level:v', '3.1',
                '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
                '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', f"{plan['audio_kbps']}k",
                '-movflags', '+faststart', '-metadata:s:v:0', 'rotate=0', '-map_metadata', '-1',
                '-threads', '2', str(output_path),
            ]
        else:
            # Production Premium+ HQ V2 benchmark formula:
            # 720p class / 29.97fps / HEVC Main10 / CRF18 / preservation-only.
            maxrate = video_kbps
            bufsize = max(1000, maxrate * 2)
            filters = [premium_v2_scale_filter(probe), 'setsar=1', 'fps=30000/1001']
            cmd = [
                'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
                '-filter_threads', '1', '-i', str(input_path), '-map', '0:v:0', '-map', '0:a:0?',
                '-vf', ','.join(filters),
                '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '18',
                '-maxrate', f'{maxrate}k', '-bufsize', f'{bufsize}k',
                '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
                '-x265-params', 'pools=1:frame-threads=1:vbv-init=0.8:scenecut=0',
                *premium_v2_color_args(probe),
                '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2', '-b:a', f"{plan['audio_kbps']}k",
                '-brand', 'isom', '-movflags', '+faststart', '-metadata:s:v:0', 'rotate=0', '-map_metadata', '-1',
                '-threads', '1', str(output_path),
            ]

        run(cmd, timeout=1200)
        if output_path.stat().st_size <= safe_limit:
            return
        print(f'status attempt {index} too large: {output_path.stat().st_size} bytes', flush=True)
    raise RuntimeError('Output Status HQ masih melebihi had Telegram 50MB.')


def encode_live_wallpaper(input_path, video_path, photo_path, probe):
    duration = min(10.0, max(1.0, probe['duration']))
    target_bytes = 8.5 * MB
    audio_kbps = 96
    total_kbps = int((target_bytes * 8 / duration / 1000) * 0.90)
    video_kbps = max(700, min(6000, total_kbps - audio_kbps - 80))
    dims = target_dimensions(probe['width'], probe['height'], video_kbps, live=True)
    filters = []
    if dims:
        filters.append(f'scale={dims[0]}:{dims[1]}:flags=lanczos')
    filters.extend(['setsar=1', 'fps=30'])
    run(
        [
            'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(input_path),
            '-t', f'{duration:.3f}', '-vf', ','.join(filters),
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            '-b:v', f'{video_kbps}k', '-maxrate', f'{int(video_kbps * 1.1)}k',
            '-bufsize', f'{max(1000, int(video_kbps * 2.2))}k',
            '-profile:v', 'high', '-level:v', '4.0',
            '-c:a', 'aac', '-b:a', f'{audio_kbps}k',
            '-movflags', '+faststart', '-map_metadata', '-1', str(video_path),
        ],
        timeout=600,
    )
    if video_path.stat().st_size > 10 * MB:
        raise RuntimeError('Live Wallpaper output melebihi 10MB.')
    cover_filters = []
    if dims:
        cover_filters.append(f'scale={dims[0]}:{dims[1]}:flags=lanczos')
    cover_filters.append('setsar=1')
    run(
        [
            'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-ss', '0.12', '-i', str(input_path),
            '-frames:v', '1', '-vf', ','.join(cover_filters), '-q:v', '3', str(photo_path),
        ],
        timeout=120,
    )



def validate_premium_status_output(source_path, output_path):
    # Fail closed before Telegram send: preserve source audio and enforce HQ codec.
    def streams(path):
        result = run([
            'ffprobe', '-v', 'error', '-show_entries',
            'stream=codec_type,codec_name,pix_fmt', '-of', 'json', str(path)
        ], timeout=60)
        return json.loads(result.stdout or '{}').get('streams') or []

    original = streams(source_path)
    encoded = streams(output_path)
    video = next((stream for stream in encoded if stream.get('codec_type') == 'video'), None)
    if not video or video.get('codec_name') != 'hevc':
        raise RuntimeError('Premium HQ output missing HEVC video track')
    if video.get('pix_fmt') not in ('yuv420p', 'yuv420p10le'):
        raise RuntimeError('Premium HQ output pixel format is not iPhone compatible')
    source_audio = any(stream.get('codec_type') == 'audio' for stream in original)
    output_audio = next((stream for stream in encoded if stream.get('codec_type') == 'audio'), None)
    if source_audio and not output_audio:
        raise RuntimeError('Premium HQ audio was lost during encoding')
    if output_audio and output_audio.get('codec_name') != 'aac':
        raise RuntimeError('Premium HQ audio codec is not AAC')
    if not output_path.exists() or output_path.stat().st_size > int(47 * MB):
        raise RuntimeError('Premium HQ output exceeds Telegram-safe size')
    print('RENDER_HQ_WORKER_VALIDATION ' + json.dumps({
        'ok': True, 'videoCodec': 'hevc',
        'pixelFormat': video.get('pix_fmt'),
        'sourceHasAudio': source_audio,
        'outputHasAudio': bool(output_audio),
        'sizeMb': round(output_path.stat().st_size / MB, 2),
    }), flush=True)


def send_status_video(path, android=False):
    metadata = probe_video(path)
    data = {
        'chat_id': str(CHAT_ID),
        'caption': status_caption(),
        'supports_streaming': 'true',
        'width': str(int(metadata.get('width') or 0)),
        'height': str(int(metadata.get('height') or 0)),
        'duration': str(max(1, int(round(metadata.get('duration') or 1)))),
    }
    with path.open('rb') as handle:
        telegram_call(
            'sendVideo',
            data,
            {'video': ('status-hq.mp4', handle, 'video/mp4')},
            timeout=300,
        )


def send_live_photo(video_path, photo_path):
    with video_path.open('rb') as video, photo_path.open('rb') as photo:
        telegram_call(
            'sendLivePhoto',
            {'chat_id': str(CHAT_ID), 'caption': 'Live Wallpaper iPhone dah siap ✅'},
            {
                'live_photo': ('live-wallpaper.mp4', video, 'video/mp4'),
                'photo': ('live-wallpaper.jpg', photo, 'image/jpeg'),
            },
            timeout=180,
        )


def allowed_provider_media_url(value):
    try:
        u = urlparse(value)
        hostname = (u.hostname or '').lower()
        if u.scheme not in ('https', 'http') or not hostname or u.username or u.password:
            return False
        if hostname == 'localhost' or hostname.endswith('.local'):
            return False
        try:
            return ipaddress.ip_address(hostname).is_global
        except ValueError:
            return True
    except (TypeError, ValueError):
        return False


def download_tikwm_source(path):
    # TikTok often blocks GitHub/Render yt-dlp while TikWM can still serve a
    # watermarked-free playable source. Fail over to yt-dlp if this provider fails.
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.tikwm.com/',
        'Origin': 'https://www.tikwm.com',
    }
    candidates = []
    for method in ('GET', 'POST'):
        try:
            if method == 'GET':
                resp = requests.get('https://www.tikwm.com/api/',
                                    params={'url': SOURCE_URL, 'hd': 1},
                                    headers=headers, timeout=(7, 15))
            else:
                resp = requests.post('https://www.tikwm.com/api/',
                                     data={'url': SOURCE_URL, 'hd': 0},
                                     headers=headers, timeout=(7, 15))
            resp.raise_for_status()
            payload = resp.json()
            if payload.get('code') != 0 or not isinstance(payload.get('data'), dict):
                continue
            values = payload['data']
            for key in ('hdplay', 'play'):
                address = str(values.get(key) or '').strip()
                if not address:
                    continue
                url = urljoin('https://www.tikwm.com/', address)
                if allowed_provider_media_url(url) and url not in candidates:
                    candidates.append(url)
            if candidates:
                break
        except (requests.RequestException, ValueError) as exc:
            print('RENDER_HQ_TIKWM_META_FAILED ' + type(exc).__name__, flush=True)
    if not candidates:
        raise RuntimeError('TikWM yielded no video candidates')
    for address in candidates[:2]:
        try:
            with requests.get(address, stream=True,
                              headers={**headers, 'Accept': 'video/*,*/*'},
                              timeout=(8, 25)) as response:
                response.raise_for_status()
                size = 0
                with path.open('wb') as dest:
                    for piece in response.iter_content(chunk_size=256*1024):
                        if not piece:
                            continue
                        size += len(piece)
                        if size > MAX_INPUT_BYTES:
                            raise RuntimeError('TikWM media exceeds 500 MB')
                        dest.write(piece)
                if size > 1024:
                    print('RENDER_HQ_TIKWM_SOURCE ' + json.dumps(
                        {'ok': True, 'bytes': size}), flush=True)
                    return
        except (requests.RequestException, OSError, RuntimeError) as exc:
            print('RENDER_HQ_TIKWM_MEDIA_FAILED ' + type(exc).__name__, flush=True)
        path.unlink(missing_ok=True)
    raise RuntimeError('TikWM videos are not downloadable from worker IP')


def download_public_social_source(path):
    # Resolve the user's /status link on a GitHub runner, away from Render's
    # 512 MB instance and its blocked social-video CDN routes.
    # Only approved social HTTPS hosts are accepted.
    if not allowed_source_url(SOURCE_URL):
        raise RuntimeError('Unsupported URL for Status HQ worker')
    host = (urlparse(SOURCE_URL).hostname or '').lower()
    if host == 'tiktok.com' or host.endswith('.tiktok.com'):
        try:
            download_tikwm_source(path)
            set_progress(30)
            return
        except Exception as exc:
            print('RENDER_HQ_TIKWM_FALLBACK ' + type(exc).__name__, flush=True)

    output_template = str(path.parent / 'source-social.%(ext)s')
    cmd = [
        sys.executable, '-m', 'yt_dlp',
        '--no-playlist', '--no-warnings', '--no-progress',
        '--js-runtimes', 'node', '--remote-components', 'ejs:github',
        '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
        '--merge-output-format', 'mp4',
        '-o', output_template,
        '--print', 'after_move:filepath',
        '--', SOURCE_URL,
    ]
    result = run(cmd, timeout=420)
    filenames = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    candidates = ([Path(filenames[-1])] if filenames else [])
    candidates += list(path.parent.glob('source-social.*'))
    selected = next((file for file in candidates if file.is_file() and file.stat().st_size), None)
    if not selected:
        raise RuntimeError('yt-dlp worker produced no playable source video')
    if selected.stat().st_size > MAX_INPUT_BYTES:
        raise RuntimeError('Public source exceeds heavy worker size limit')
    shutil.move(str(selected), str(path))
    set_progress(30)


def download_source(path):
    set_progress(5)
    if SOURCE_URL:
        download_public_social_source(path)
        return
    app = Client('heavy_media_worker', api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN, in_memory=True)
    with app:
        downloaded = app.download_media(VIDEO_FILE_ID, file_name=str(path))
        if not downloaded and SOURCE_MESSAGE_ID:
            try:
                message = app.get_messages(CHAT_ID, SOURCE_MESSAGE_ID)
                downloaded = app.download_media(message, file_name=str(path))
            except Exception as exc:
                print(f'message fallback failed: {exc}', flush=True)
        if not downloaded:
            raise RuntimeError('MTProto tak dapat download video Telegram ini.')
    if not path.exists() or path.stat().st_size <= 0:
        raise RuntimeError('Video download kosong.')
    if path.stat().st_size > MAX_INPUT_BYTES:
        raise RuntimeError(f'Video melebihi limit {MAX_INPUT_MB}MB.')
    set_progress(30)


def main():
    require_config()
    print(f'heavy worker action={ACTION} input={FILE_SIZE} chat={CHAT_ID}', flush=True)
    with tempfile.TemporaryDirectory(prefix='abangrender-heavy-') as temp_dir:
        temp = Path(temp_dir)
        source = temp / 'source-video.bin'
        download_source(source)
        probe = probe_video(source)
        print(f'probe={probe}', flush=True)

        if ACTION == 'live_wallpaper':
            set_progress(42)
            live_video = temp / 'live-wallpaper.mp4'
            cover = temp / 'live-wallpaper.jpg'
            encode_live_wallpaper(source, live_video, cover, probe)
            set_progress(88)
            set_progress(100)
            send_live_photo(live_video, cover)
        elif ACTION == 'status_hq_android':
            set_progress(42)
            output = temp / 'status-hq-android.mp4'
            encode_status(source, output, probe, android=True)
            set_progress(88)
            set_progress(100)
            send_status_video(output, android=True)
        else:
            set_progress(42)
            output = temp / 'status-hq.mp4'
            encode_status(source, output, probe, android=False)
            validate_premium_status_output(source, output)
            set_progress(88)
            set_progress(100)
            send_status_video(output, android=False)

        finish_progress()
        print('heavy worker complete', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'heavy worker failed: {type(exc).__name__}: {exc}', flush=True)
        fail_progress('Proses video besar tak berjaya. Cuba hantar semula atau guna video yang lebih kecil.')
        raise
