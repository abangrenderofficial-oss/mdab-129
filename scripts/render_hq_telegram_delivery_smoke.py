"""Manual, owner-approved Telegram sendVideo test.
No webhook changes, no user lookup, no statistics or payment writes.
Synthetic 2-second 320x180 source, encoded by the real Premium HQ worker.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import heavy_status_worker as worker

def fail(reason):
    print('MEDIAX_HQ_MANUAL_SEND', json.dumps({'ok': False, 'reason': reason}), flush=True)
    sys.exit(1)

chat_raw = os.environ.get('HQ_TEST_PRIVATE_CHAT_ID', '').strip()
approval = os.environ.get('HQ_TEST_APPROVAL', '').strip()
if approval != 'SEND_TEST_TO_MY_PRIVATE_CHAT':
    fail('explicit_approval_required')
if not chat_raw.isdigit() or int(chat_raw) <= 0:
    fail('invalid_private_chat_id')
if not os.environ.get('TELEGRAM_BOT_TOKEN', '').strip():
    fail('token_missing')
chat_id = int(chat_raw)
try:
    # Fail closed unless this bot has an existing private chat with the target.
    chat = worker.telegram_call('getChat', {'chat_id': str(chat_id)}, timeout=20)
    if (str(chat.get('type') or '') != 'private'
            or int(chat.get('id') or 0) != chat_id):
        fail('target_is_not_an_existing_private_chat')
    with tempfile.TemporaryDirectory(prefix='mediax-render-hq-private-test-') as temp:
        directory = Path(temp)
        source = directory / 'sample-source.mp4'
        output = directory / 'sample-hq.mp4'
        subprocess.run([
            'ffmpeg','-hide_banner','-loglevel','error','-y',
            '-f','lavfi','-i','testsrc2=size=320x180:rate=15',
            '-f','lavfi','-i','sine=frequency=440:sample_rate=44100',
            '-t','2','-c:v','libx264','-preset','ultrafast','-c:a','aac',
            str(source),
        ],check=True,timeout=45,capture_output=True)
        meta = worker.probe_video(source)
        worker.encode_status(source,output,meta)
        worker.validate_premium_status_output(source,output)
        worker.CHAT_ID=chat_id
        worker.status_caption=lambda: '🧪 MediaX Render HQ test — video 2 saat (bukan video user).'
        worker.send_status_video(output)
        print('MEDIAX_HQ_MANUAL_SEND',json.dumps({
            'ok':True,'delivery':'telegram_sendVideo_confirmed',
            'codec':'HEVC','audio':'AAC','syntheticDurationSeconds':2,
            'sizeBytes':output.stat().st_size,'statsModified':False,
            'webhookModified':False,
        }),flush=True)
except Exception as error:
    # Never include Telegram token, request URL, target identity or file IDs.
    fail(type(error).__name__)
