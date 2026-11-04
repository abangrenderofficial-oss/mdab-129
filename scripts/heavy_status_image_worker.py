"""Premium+ HQ for image Documents over the Cloud Bot API 20 MB download cap.

Same image formula as the bot's local path (src/status-image-hq.js):
  * JPEG source  -> original bytes kept, no re-encode, no resize.
  * Other format -> one high-quality JPEG (yuvj444p, q:v 2), original size.
Downloaded through MTProto so files above 20 MB work.
"""
import os
import subprocess
import tempfile
from pathlib import Path

import requests
from pyrogram import Client

MB = 1024 * 1024
BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '').strip()
API_ID = int(os.environ.get('TELEGRAM_API_ID', '0') or 0)
API_HASH = os.environ.get('TELEGRAM_API_HASH', '').strip()
CHAT_ID = int(os.environ.get('HEAVY_CHAT_ID', '0') or 0)
FILE_ID = os.environ.get('HEAVY_VIDEO_FILE_ID', '').strip()
FILE_SIZE = int(os.environ.get('HEAVY_FILE_SIZE', '0') or 0)
PROGRESS_MESSAGE_ID = int(os.environ.get('HEAVY_PROGRESS_MESSAGE_ID', '0') or 0)
SOURCE_MESSAGE_ID = int(os.environ.get('HEAVY_SOURCE_MESSAGE_ID', '0') or 0)
MAX_INPUT_BYTES = int(os.environ.get('HEAVY_IMAGE_MAX_MB', '50') or 50) * MB
# Bot API sendDocument upload cap is 50 MB; keep a small safety margin.
SEND_LIMIT_BYTES = int(49.5 * MB)
BOT_API_BASE = os.environ.get('TELEGRAM_API_BASE_URL', 'https://api.telegram.org').rstrip('/')


def require_config():
    missing = [name for name, value in (
        ('TELEGRAM_BOT_TOKEN', BOT_TOKEN), ('TELEGRAM_API_ID', API_ID), ('TELEGRAM_API_HASH', API_HASH),
        ('HEAVY_CHAT_ID', CHAT_ID), ('HEAVY_VIDEO_FILE_ID', FILE_ID),
    ) if not value]
    if missing:
        raise RuntimeError('Missing required configuration: ' + ', '.join(missing))
    if FILE_SIZE > MAX_INPUT_BYTES:
        raise RuntimeError(f'Image exceeds {MAX_INPUT_BYTES // MB}MB limit.')


def telegram_call(method, data=None, files=None, timeout=180):
    response = requests.post(f'{BOT_API_BASE}/bot{BOT_TOKEN}/{method}', data=data or {}, files=files, timeout=timeout)
    try:
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f'Telegram {method} returned HTTP {response.status_code}') from exc
    if not response.ok or not payload.get('ok'):
        raise RuntimeError(payload.get('description') or f'Telegram {method} failed ({response.status_code})')
    return payload.get('result')


def progress_text(percent):
    value = max(1, min(100, int(round(percent))))
    filled = 10 if value >= 100 else min(9, value // 10)
    bar = '▰' * filled + '▱' * (10 - filled)
    title = 'Your Image Is Ready ✅' if value >= 100 else 'Your Image Is on Its Way...'
    return f'{title}\n\n{bar} {value}% 🔋'


def set_progress(percent):
    if not PROGRESS_MESSAGE_ID:
        return
    try:
        telegram_call('editMessageText', {
            'chat_id': str(CHAT_ID), 'message_id': str(PROGRESS_MESSAGE_ID), 'text': progress_text(percent),
        }, timeout=30)
    except Exception as exc:
        print(f'progress update failed: {exc}', flush=True)


def finish_progress():
    if not PROGRESS_MESSAGE_ID:
        return
    try:
        telegram_call('deleteMessage', {'chat_id': str(CHAT_ID), 'message_id': str(PROGRESS_MESSAGE_ID)}, timeout=30)
    except Exception as exc:
        print(f'progress delete failed: {exc}', flush=True)


def fail_progress(message):
    text = f'❌ {message}'[:4096]
    if PROGRESS_MESSAGE_ID:
        try:
            telegram_call('editMessageText', {
                'chat_id': str(CHAT_ID), 'message_id': str(PROGRESS_MESSAGE_ID), 'text': text,
            }, timeout=30)
            return
        except Exception:
            pass
    try:
        telegram_call('sendMessage', {'chat_id': str(CHAT_ID), 'text': text}, timeout=30)
    except Exception:
        pass


def status_caption():
    try:
        username = str((telegram_call('getMe', timeout=30) or {}).get('username') or '').strip().lstrip('@')
        if username:
            return f'Image Ready For Status ✅\nDownload In @{username}'
    except Exception as exc:
        print(f'bot username lookup failed: {exc}', flush=True)
    return 'Image Ready For Status ✅'


def download_source(path):
    set_progress(5)
    app = Client('heavy_image_worker', api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN, in_memory=True)
    with app:
        downloaded = app.download_media(FILE_ID, file_name=str(path))
        if not downloaded and SOURCE_MESSAGE_ID:
            try:
                message = app.get_messages(CHAT_ID, SOURCE_MESSAGE_ID)
                downloaded = app.download_media(message, file_name=str(path))
            except Exception as exc:
                print(f'message fallback failed: {exc}', flush=True)
        if not downloaded:
            raise RuntimeError('MTProto could not download this Telegram image.')
    if not path.exists() or path.stat().st_size <= 0:
        raise RuntimeError('Image download is empty.')
    if path.stat().st_size > MAX_INPUT_BYTES:
        raise RuntimeError(f'Image exceeds {MAX_INPUT_BYTES // MB}MB limit.')
    set_progress(40)


def is_jpeg(path):
    with path.open('rb') as handle:
        return handle.read(3) == b'\xff\xd8\xff'


def encode_jpeg(source, output, quality):
    cmd = [
        'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-i', str(source), '-frames:v', '1', '-pix_fmt', 'yuvj444p',
        '-q:v', str(quality), '-map_metadata', '-1', str(output),
    ]
    print('$ ' + ' '.join(cmd), flush=True)
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=300)


def prepare(source, temp):
    if is_jpeg(source) and source.stat().st_size <= SEND_LIMIT_BYTES:
        print('JPEG source: keeping original bytes', flush=True)
        return source
    output = temp / 'status-hq.jpg'
    for quality in (2, 3, 4):
        encode_jpeg(source, output, quality)
        if output.exists() and 0 < output.stat().st_size <= SEND_LIMIT_BYTES:
            return output
        print(f'jpeg q={quality} too large: {output.stat().st_size if output.exists() else 0}', flush=True)
    raise RuntimeError('Premium+ HQ image is still above the 50 MB Telegram send limit.')


def main():
    require_config()
    print(f'heavy image worker input={FILE_SIZE} chat={CHAT_ID}', flush=True)
    with tempfile.TemporaryDirectory(prefix='abangrender-heavy-image-') as temp_dir:
        temp = Path(temp_dir)
        source = temp / 'source-image.bin'
        download_source(source)
        prepared = prepare(source, temp)
        set_progress(90)
        set_progress(100)
        with prepared.open('rb') as handle:
            telegram_call('sendDocument', {'chat_id': str(CHAT_ID), 'caption': status_caption()},
                          {'document': ('status-hq.jpg', handle, 'image/jpeg')}, timeout=300)
        finish_progress()
        print('heavy image worker complete', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'heavy image worker failed: {type(exc).__name__}: {exc}', flush=True)
        fail_progress('Large image processing failed. Please resend the image as a Document and try again.')
        raise
