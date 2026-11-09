# TikTok "hidden video" rescue (e.g. promoted/ad posts).
# Bot Hosting only gets an audio-only MP3 for these (TikTok hides the video on
# web; TikWM blocks the Bot Hosting IP). This runner resolves the real MP4 via
# TikWM, verifies it has a video stream, and sends it to the user's chat with
# the same MediaX buttons. Normal TikTok links never reach this worker.
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import requests

TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['HIDDEN_CHAT_ID']
SOURCE_URL = os.environ['HIDDEN_SOURCE_URL']
REPLY_MARKUP = os.environ.get('HIDDEN_REPLY_MARKUP', '').strip()
MAX_BYTES = 49 * 1024 * 1024
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
API = f'https://api.telegram.org/bot{TOKEN}'


def telegram(method, data=None, files=None, timeout=120):
    r = requests.post(f'{API}/{method}', data=data or {}, files=files, timeout=timeout)
    payload = r.json()
    if not payload.get('ok'):
        raise RuntimeError(f'Telegram {method} failed: {payload.get("description")}')
    return payload['result']


def tikwm(url):
    last = None
    for attempt in range(4):
        try:
            r = requests.get('https://www.tikwm.com/api/', params={'url': url, 'hd': '1'},
                             headers={'User-Agent': UA, 'Accept': 'application/json'}, timeout=30)
            j = r.json()
            if j.get('code') == 0 and j.get('data'):
                return j['data']
            last = j.get('msg')
        except Exception as exc:
            last = exc
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f'TikWM failed: {last}')


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
                          'stream=codec_type,width,height:format=duration', '-of', 'json', str(path)],
                         capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    video = next((s for s in j.get('streams', []) if s.get('codec_type') == 'video'), None)
    return video, float(j.get('format', {}).get('duration') or 0)


def main():
    data = tikwm(SOURCE_URL)
    candidates = [u for u in (data.get('hdplay'), data.get('play')) if u]
    if not candidates:
        raise RuntimeError('TikWM returned no video URL.')
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'tiktok.mp4'
        chosen = None
        for url in candidates:
            if url.startswith('/'):
                url = 'https://www.tikwm.com' + url
            r = requests.get(url, headers={'User-Agent': UA, 'Referer': 'https://www.tiktok.com/'}, timeout=120, stream=True)
            r.raise_for_status()
            with path.open('wb') as fh:
                for chunk in r.iter_content(1 << 20):
                    fh.write(chunk)
            video, duration = probe(path)
            size = path.stat().st_size
            print(f'candidate size={size} video={bool(video)} duration={duration}', flush=True)
            if video and 0 < size <= MAX_BYTES:
                chosen = (video, duration)
                break
        if not chosen:
            raise RuntimeError('No playable TikTok video under the Telegram limit.')
        video, duration = chosen
        fields = {
            'chat_id': CHAT_ID, 'supports_streaming': 'true',
            'width': str(video.get('width') or 0), 'height': str(video.get('height') or 0),
            'duration': str(max(1, int(round(duration)))),
        }
        if REPLY_MARKUP:
            fields['reply_markup'] = REPLY_MARKUP
        with path.open('rb') as fh:
            telegram('sendVideo', fields, {'video': ('tiktok.mp4', fh, 'video/mp4')}, timeout=300)
        print('delivered', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'hidden video worker failed: {exc}', flush=True)
        try:
            telegram('sendMessage', {'chat_id': CHAT_ID, 'text': '❌ Video TikTok ini tak dapat dimuat turun (TikTok sembunyikan fail videonya). Cuba link lain.'})
        except Exception:
            pass
        sys.exit(1)
