"""Owner-selected original HQ Lab formula for large Telegram video Documents.

MTProto downloads/uploads large videos; Node/FFmpeg uses an independent copy of
the three ORIGINAL HQ Lab formulas, not the production encoder or quality guard.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

from pyrogram import Client
import hqlab_v3_worker as common

FORMULAS = {
    "cplus": "C+ HQ",
    "premiumplus": "Premium+ HQ Old",
    "premiumplus-v2": "Premium+ HQ V2",
}

def main():
    choice = os.environ.get("HQLAB_FORMULA", "").strip()
    if choice not in FORMULAS:
        raise RuntimeError("Unsupported HQ Lab formula.")
    if not common.BOT_TOKEN or not common.API_ID or not common.API_HASH or not common.FILE_ID:
        raise RuntimeError("Missing HQ Lab worker configuration.")
    if common.CHAT_ID <= 0 or common.CHAT_ID != common.USER_ID:
        raise RuntimeError("HQ Lab requires owner private chat.")
    if common.SIZE > common.MAX_SOURCE:
        raise RuntimeError("Input Document exceeds 500 MiB.")
    common.notify("🧪 HQ Lab: Processing " + FORMULAS[choice] + " (one selected formula).")
    with tempfile.TemporaryDirectory(prefix="mediax-hqlab-choice-") as directory:
        root = Path(directory)
        source = root / "source.bin"
        output = root / "selected-hq.mp4"
        details = root / "metadata.json"
        with Client("hqlab_selected_owner", api_id=common.API_ID,
                    api_hash=common.API_HASH, bot_token=common.BOT_TOKEN,
                    in_memory=True) as client:
            downloaded = client.download_media(common.FILE_ID, file_name=str(source))
            if not downloaded or not source.is_file():
                raise RuntimeError("Could not download HQ Lab source via MTProto.")
            if source.stat().st_size > common.MAX_SOURCE:
                raise RuntimeError("HQ Lab Document exceeds 500 MiB.")

            run = subprocess.run(
                ["node", "scripts/hqlab_choice_encode.mjs",
                 str(source), str(output), str(details), choice],
                text=True, capture_output=True, timeout=12*60,
            )
            if run.returncode:
                raise RuntimeError("HQ Lab selected formula encoding failed: " +
                                   run.stderr[-900:])
            if not output.is_file() or output.stat().st_size <= 0:
                raise RuntimeError("HQ Lab encoded output was not found.")
            info = json.loads(details.read_text())
            caption = (
                "🧪 HQ Lab — " + FORMULAS[choice] + "\n"
                f"📐 {info.get('width')} × {info.get('height')}\n"
                f"🎞 {float(info.get('fps') or 0):.2f} FPS\n"
                f"📊 Target bitrate: {int(info.get('videoKbps') or 0)} kbps\n"
                f"📦 {output.stat().st_size / (1024*1024):.2f} MiB\n"
                "📎 Selected formula only. Production Premium+ HQ unchanged."
            )
            client.send_document(
                common.CHAT_ID, str(output),
                caption=caption, file_name=f"HQLab-{choice}.mp4",
            )
    print("HQ Lab selected original formula delivered:", choice, flush=True)

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("HQ Lab selected formula failed:", str(exc), flush=True)
        common.notify("❌ HQ Lab selected formula failed: " + str(exc)[:270])
        raise
