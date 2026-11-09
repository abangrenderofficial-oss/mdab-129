import json
import math
import os
import subprocess
import tempfile
import time
from pathlib import Path

import requests
from pyrogram import Client

MB = 1024 * 1024
BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '').strip()
API_ID = int(os.environ.get('TELEGRAM_API_ID', '0') or 0)
API_HASH = os.environ.get('TELEGRAM_API_HASH', '').strip()
CHAT_ID = int(os.environ.get('HEAVY_CHAT_ID', '0') or 0)
VIDEO_FILE_ID = os.environ.get('HEAVY_VIDEO_FILE_ID', '').strip()
FILE_SIZE = int(os.environ.get('HEAVY_FILE_SIZE', '0') or 0)
ACTION = os.environ.get('HEAVY_ACTION', 'status_hq').strip() or 'status_hq'
PROGRESS_MESSAGE_ID = int(os.environ.get('HEAVY_PROGRESS_MESSAGE_ID', '0') or 0)
SOURCE_MESSAGE_ID = int(os.environ.get('HEAVY_SOURCE_MESSAGE_ID', '0') or 0)
MAX_INPUT_MB = int(os.environ.get('HEAVY_VIDEO_MAX_MB', '250') or 250)
MAX_INPUT_BYTES = MAX_INPUT_MB * MB
BOT_API_BASE = os.environ.get('TELEGRAM_API_BASE_URL', 'https://api.telegram.org').rstrip('/')
SOURCE_KIND = os.environ.get('HEAVY_SOURCE_KIND', 'link').strip().lower()
IS_GALLERY_UPLOAD = SOURCE_KIND == 'gallery'
UPLOAD_PRESET_H264 = os.environ.get('STATUS_UPLOAD_HEAVY_PRESET', 'slow').strip().lower() or 'slow'
UPLOAD_DENOISE = os.environ.get('STATUS_UPLOAD_DENOISE', '0').strip().lower() in ('1', 'true', 'yes', 'on')


def upload_maxrate_cap():
    try:
        value = int(float(os.environ.get('STATUS_UPLOAD_MAXRATE_KBPS', '5000') or 5000))
    except ValueError:
        return 5000
    if value <= 0:
        return 5000
    return max(2000, min(12000, value))


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
    if not VIDEO_FILE_ID:
        missing.append('HEAVY_VIDEO_FILE_ID')
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


def parse_rate(value):
    try:
        text = str(value or '')
        if '/' in text:
            num, den = text.split('/', 1)
            return float(num) / float(den) if float(den) else 0.0
        return float(text or 0)
    except Exception:
        return 0.0


def probe_video(path):
    result = run(
        [
            'ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_entries',
            'stream=width,height,r_frame_rate,avg_frame_rate,color_range,color_space,color_transfer,color_primaries:format=duration',
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
        'fps': parse_rate(stream.get('avg_frame_rate')) or parse_rate(stream.get('r_frame_rate')),
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
    max_video_kbps = 2800 if android else (upload_maxrate_cap() if IS_GALLERY_UPLOAD else 5000)
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


# Uploaded-video (gallery) Premium+ HQ only. Link Premium+ and Android HQ keep
# their existing formulas. GitHub runners have 4 vCPU and a 1200s budget, so the
# upload profile uses a real x265 preset with all cores instead of ultrafast/1 thread.
def upload_tonemap_filter(probe):
    transfer = str(probe.get('color_transfer') or '').lower()
    primaries = str(probe.get('color_primaries') or '').lower()
    bt2020 = 'bt2020' in primaries or 'bt2020' in str(probe.get('color_space') or '').lower()
    if not bt2020 or transfer not in ('arib-std-b67', 'smpte2084'):
        return None
    return ','.join([
        f'zscale=tin={transfer}:pin=bt2020:min=bt2020nc:rin=tv:t=linear:npl=100',
        'format=gbrpf32le',
        'zscale=p=bt709',
        'tonemap=tonemap=hable:desat=0',
        'zscale=t=bt709:m=bt709:r=tv',
        'format=yuv420p',
    ])


def upload_target_fps(fps):
    # <=30fps: keep native. Higher: drop by a whole factor so motion stays even
    # (50 -> 25, 59.94 -> 29.97, 60 -> 30, 120 -> 30); otherwise 30.
    fps = float(fps or 0)
    if 0 < fps <= 30.5:
        return None
    if fps > 30.5:
        for n in range(2, 9):
            target = fps / n
            if 23.5 <= target <= 30.5:
                return round(target, 3)
    return 30


def upload_fps_filter(probe):
    target = upload_target_fps(probe.get('fps'))
    if target is None:
        return None
    return f'fps={target:g}'


def upload_status_cmd(input_path, output_path, probe, maxrate, bufsize, audio_kbps):
    # Upload-v4 (WhatsApp-tuned): WhatsApp Status always re-encodes to
    # 720x1280 ~2.2 Mbps, so give it a clean H.264 720p source at ~5 Mbps
    # with light sharpening + film tuning (best result in owner A/B tests).
    filters = [
        premium_v2_scale_filter(probe), 'setsar=1', upload_tonemap_filter(probe),
        # Light denoise (after downscale, cheap): camera grain no longer
        # eats WhatsApp's fixed ~2.2 Mbps; then sharpen real edges.
        'hqdn3d=1.5:1.0:3:2.25' if UPLOAD_DENOISE else None,
        'unsharp=5:5:0.55:5:5:0.0', upload_fps_filter(probe),
    ]
    return [
        'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-i', str(input_path), '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', ','.join(f for f in filters if f),
        '-c:v', 'libx264', '-preset', UPLOAD_PRESET_H264, '-tune', 'film', '-crf', '18',
        '-maxrate', f'{maxrate}k', '-bufsize', f'{bufsize}k',
        '-profile:v', 'high', '-level:v', '3.1', '-pix_fmt', 'yuv420p',
        '-x264-params', 'aq-mode=3:psy-rd=1.0,0.15',
        '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
        '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2', '-b:a', f'{audio_kbps}k',
        '-movflags', '+faststart', '-metadata:s:v:0', 'rotate=0', '-map_metadata', '-1',
        '-threads', '0', str(output_path),
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
        elif IS_GALLERY_UPLOAD:
            maxrate = video_kbps
            bufsize = max(1000, maxrate * 2)
            cmd = upload_status_cmd(input_path, output_path, probe, maxrate, bufsize, plan['audio_kbps'])
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


DOWNLOAD_ATTEMPTS = 3


def download_progress_callback():
    # Map MTProto download progress to the user's bar (5% -> 30%) so a large
    # upload no longer looks frozen at 5% while Telegram streams the file.
    state = {'last': 0.0, 'pct': 5}

    def callback(current, total):
        if not total:
            return
        now = time.monotonic()
        pct = 5 + int(25 * min(1.0, current / float(total)))
        if pct > state['pct'] and now - state['last'] >= 4:
            state['last'] = now
            state['pct'] = pct
            set_progress(pct)

    return callback


def download_once(path, attempt):
    # Fresh client per attempt: a stuck media DC session is not reused.
    app = Client(
        f'heavy_media_worker_{attempt}', api_id=API_ID, api_hash=API_HASH,
        bot_token=BOT_TOKEN, in_memory=True,
    )
    progress = download_progress_callback()
    with app:
        downloaded = None
        try:
            downloaded = app.download_media(VIDEO_FILE_ID, file_name=str(path), progress=progress)
        except Exception as exc:
            if not SOURCE_MESSAGE_ID:
                raise
            print(f'file_id download failed ({type(exc).__name__}: {exc}); trying source message', flush=True)
        if not downloaded and SOURCE_MESSAGE_ID:
            message = app.get_messages(CHAT_ID, SOURCE_MESSAGE_ID)
            downloaded = app.download_media(message, file_name=str(path), progress=progress)
        return downloaded


def download_source(path):
    set_progress(5)
    last_error = None
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            if path.exists():
                path.unlink()
            downloaded = download_once(path, attempt)
            if downloaded and path.exists() and path.stat().st_size > 0:
                break
            last_error = RuntimeError('MTProto tak dapat download video Telegram ini.')
        except Exception as exc:
            last_error = exc
        print(f'download attempt {attempt}/{DOWNLOAD_ATTEMPTS} failed: {type(last_error).__name__}: {last_error}', flush=True)
        if attempt < DOWNLOAD_ATTEMPTS:
            time.sleep(5 * attempt)
    else:
        raise RuntimeError(f'MTProto download gagal selepas {DOWNLOAD_ATTEMPTS} cubaan: {last_error}')
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
