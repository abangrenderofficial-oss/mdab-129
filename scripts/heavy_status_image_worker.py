"""MediaX uploaded IMAGE Premium+ HQ (18-50 MiB) worker.

MTProto downloads the original Telegram Document and sends precisely the
same bytes as a Telegram Document. Never resize, sharpen, or re-encode.
Video Premium+ HQ, Android and HQLab paths are not imported or changed.
"""
import hashlib
import os
from pathlib import Path
import tempfile

import requests
from pyrogram import Client

BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '').strip()
API_ID = int(os.environ.get('TELEGRAM_API_ID', '0') or 0)
API_HASH = os.environ.get('TELEGRAM_API_HASH', '').strip()
CHAT_ID = int(os.environ.get('HEAVY_CHAT_ID', '0') or 0)
FILE_ID = os.environ.get('HEAVY_VIDEO_FILE_ID', '').strip()
FILE_SIZE = int(os.environ.get('HEAVY_FILE_SIZE', '0') or 0)
SOURCE_MESSAGE_ID = int(os.environ.get('HEAVY_SOURCE_MESSAGE_ID', '0') or 0)
PROGRESS_MESSAGE_ID = int(os.environ.get('HEAVY_PROGRESS_MESSAGE_ID', '0') or 0)
BASE = os.environ.get('TELEGRAM_API_BASE_URL', 'https://api.telegram.org').rstrip('/')
MAX_BYTES = 50 * 1024 * 1024


def telegram(method, data=None, files=None, timeout=180):
    response = requests.post(
        f'{BASE}/bot{BOT_TOKEN}/{method}', data=data or {},
        files=files, timeout=timeout,
    )
    payload = response.json()
    if not response.ok or not payload.get('ok'):
        raise RuntimeError(f'Telegram {method}: ' +
                           str(payload.get('description') or response.status_code))
    return payload.get('result') or {}


def progress(percent):
    if not PROGRESS_MESSAGE_ID:
        return
    value = max(1, min(100, int(percent)))
    filled = 10 if value == 100 else min(9, value // 10)
    text = ('Your Image Is Ready ✅' if value == 100
            else 'Your Image Is on Its Way...') + '\n\n' + (
                '▰' * filled + '▱' * (10 - filled)) + f' {value}% 🔋'
    try:
        telegram('editMessageText', {
            'chat_id': CHAT_ID,
            'message_id': PROGRESS_MESSAGE_ID,
            'text': text,
        }, timeout=25)
    except Exception as exc:
        print('progress update failed:', str(exc)[:160], flush=True)


def finish():
    if PROGRESS_MESSAGE_ID:
        try:
            telegram('deleteMessage', {
                'chat_id': CHAT_ID,
                'message_id': PROGRESS_MESSAGE_ID,
            }, timeout=25)
        except Exception:
            pass


def fail(message):
    text = '❌ ' + message
    if PROGRESS_MESSAGE_ID:
        try:
            telegram('editMessageText', {
                'chat_id': CHAT_ID,
                'message_id': PROGRESS_MESSAGE_ID,
                'text': text,
            }, timeout=25)
            return
        except Exception:
            pass
    telegram('sendMessage', {'chat_id': CHAT_ID, 'text': text}, timeout=25)


def status_caption():
    try:
        username = str(telegram('getMe', timeout=25).get('username') or '').strip().lstrip('@')
        if username:
            return f'Image Ready For Status ✅\\nDownload In @{username}'
    except Exception:
        pass
    return 'Image Ready For Status ✅'


def image_format(header):
    if header.startswith(bytes([0xff, 0xd8, 0xff])):
        return 'jpg', 'image/jpeg'
    if header.startswith(bytes([137, 80, 78, 71, 13, 10, 26, 10])):
        return 'png', 'image/png'
    if header[:4] == b'RIFF' and header[8:12] == b'WEBP':
        return 'webp', 'image/webp'
    if header[:2] == b'BM':
        return 'bmp', 'image/bmp'
    if header[:4] in (bytes([73, 73, 42, 0]), bytes([77, 77, 0, 42])):
        return 'tiff', 'image/tiff'
    return '', ''


def validate():
    if not BOT_TOKEN or not API_ID or not API_HASH or not CHAT_ID or not FILE_ID:
        raise RuntimeError('Missing Telegram worker credentials or image file_id')
    if FILE_SIZE > MAX_BYTES:
        raise RuntimeError('Original image exceeds 50MiB Telegram upload limit')


def main():
    validate()
    with tempfile.TemporaryDirectory(prefix='mediax-image-hq-') as tmp:
        source = Path(tmp) / 'original-image.bin'
        progress(6)
        client = Client(
            'mediax_image_hq', api_id=API_ID, api_hash=API_HASH,
            bot_token=BOT_TOKEN, in_memory=True,
        )
        with client:
            downloaded = client.download_media(FILE_ID, file_name=str(source))
            if not downloaded and SOURCE_MESSAGE_ID:
                try:
                    message = client.get_messages(CHAT_ID, SOURCE_MESSAGE_ID)
                    downloaded = client.download_media(message, file_name=str(source))
                except Exception as exc:
                    print('message fallback failed:', str(exc)[:220], flush=True)
            if not downloaded:
                raise RuntimeError('Telegram Document image could not be downloaded')
        if not source.is_file():
            candidate = Path(str(downloaded))
            if candidate.is_file():
                source = candidate
        size = source.stat().st_size
        if not (0 < size <= MAX_BYTES):
            raise RuntimeError('Image is empty or exceeds 50MiB')
        ext, mime = image_format(source.open('rb').read(16))
        if not ext:
            raise RuntimeError('Original image format is not JPEG/PNG/WEBP/BMP/TIFF')
        progress(78)
        original_sha = hashlib.sha256(source.read_bytes()).hexdigest()
        with source.open('rb') as data:
            result = telegram('sendDocument', {
                'chat_id': CHAT_ID,
                'caption': 'Image Ready For Status ✅',
                'disable_content_type_detection': 'true',
            }, files={'document': (f'status-hq.{ext}', data, mime)}, timeout=240)
        attachment = result.get('document') or {}
        if not attachment.get('file_id'):
            raise RuntimeError('Telegram did not acknowledge a Document attachment')
        if int(attachment.get('file_size') or 0) != size:
            raise RuntimeError('Telegram Document size differs from preserved source')
        progress(100)
        finish()
        print('PREMIUM_IMAGE_HQ_ORIGINAL_BYTES_PRESERVED', {
            'bytes': size, 'sha256': original_sha, 'format': ext,
            'telegram_size': attachment['file_size'], 'filename': f'status-hq.{ext}'
        }, flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('PREMIUM_IMAGE_HQ_FAILED', type(error).__name__, str(error)[:550], flush=True)
        try:
            fail('Premium+ HQ gambar gagal diproses. Hantar gambar asal sebagai File/Document dan cuba semula.')
        except Exception:
            pass
        raise
