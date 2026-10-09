"""Read-only MTProto authorization check for the existing GitHub video worker.
No get_updates, no chat reads, no send, and no Telegram webhook changes.
"""
import json
import os
import sys
from pyrogram import Client

def report(ok, reason=''):
    print('MEDIAX_RENDER_MT_PROTO_READINESS '+json.dumps({
        'ok':bool(ok), 'reason':reason or ('authorized' if ok else 'unknown')
    }), flush=True)

api_id = os.getenv('TELEGRAM_API_ID', '').strip()
api_hash = os.getenv('TELEGRAM_API_HASH', '').strip()
bot_token = os.getenv('TELEGRAM_BOT_TOKEN', '').strip()
if not api_id.isdigit() or not api_hash or not bot_token:
    report(False, 'missing_worker_credentials')
    sys.exit(1)
try:
    with Client(
        'mediax_render_hq_readonly_probe',
        api_id=int(api_id), api_hash=api_hash, bot_token=bot_token,
        in_memory=True, no_updates=True,
    ) as app:
        me=app.get_me()
        if not getattr(me, 'is_bot', False):
            raise RuntimeError('mtproto_identity_not_bot')
    report(True)
except Exception as exc:
    report(False, type(exc).__name__)
    sys.exit(1)
