# Owner-only experiment: does WhatsApp Status re-compress our output?
# Encodes the same uploaded video into several variants and sends each to
# the owner chat. The owner opens each in the WhatsApp Status editor and
# compares the MB shown there with the file size in the caption.
import os
import tempfile
from pathlib import Path

import heavy_status_worker as w

MB = 1024 * 1024
AUDIO_KBPS = 128


def encode(src, out, probe, codec, total_mb, denoise=False, height=1280):
    dur = max(1.0, probe['duration'])
    video_kbps = max(300, int(total_mb * 8 * 1_000_000 / dur / 1000 * 0.96) - AUDIO_KBPS)
    scale = w.premium_v2_scale_filter(probe)
    if height != 1280:
        scale = scale.replace('1280', str(height)).replace('720', str(height * 9 // 16))
    filters = [
        'hqdn3d=2:1.5:4:3' if denoise else None,
        scale, 'setsar=1', w.upload_tonemap_filter(probe), w.upload_fps_filter(probe),
    ]
    vf = ','.join(f for f in filters if f)
    common_v = ['-vf', vf, '-pix_fmt', 'yuv420p',
                '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']
    rate = ['-b:v', f'{video_kbps}k', '-maxrate', f'{int(video_kbps * 1.5)}k', '-bufsize', f'{video_kbps * 2}k']
    audio = ['-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', f'{AUDIO_KBPS}k']
    tail = ['-movflags', '+faststart', '-map_metadata', '-1', str(out)]
    base = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', str(src), '-map', '0:v:0']
    if codec == 'h264':
        x264 = ['-x264-params', 'aq-mode=3:aq-strength=1.0:deblock=1,1'] if denoise else []
        venc = ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level:v', '3.1', *rate, *x264,
                '-passlogfile', str(out) + '.log']
        w.run(base + common_v + venc + ['-pass', '1', '-an', '-f', 'mp4', os.devnull], timeout=1500)
        w.run(base + ['-map', '0:a:0?'] + common_v + venc + ['-pass', '2'] + audio + tail, timeout=1500)
    else:
        stats = str(out) + '.x265'
        venc = ['-c:v', 'libx265', '-preset', 'slow', *rate, '-tag:v', 'hvc1']
        w.run(base + common_v + venc + ['-x265-params', f'pass=1:stats={stats}', '-an', '-f', 'mp4', os.devnull], timeout=1500)
        w.run(base + ['-map', '0:a:0?'] + common_v + venc + ['-x265-params', f'pass=2:stats={stats}'] + audio + tail, timeout=1500)
    return video_kbps


def main():
    w.require_config()
    all_variants = {
        'A': ('h264', 5.3, False, 1280, 'H.264 720p ~5.3MB (bawah sasaran WhatsApp)'),
        'B': ('hevc', 5.3, False, 1280, 'HEVC 720p ~5.3MB (uji teori HEVC)'),
        'C': ('h264', 9.0, False, 1280, 'H.264 720p ~9MB (lebih sasaran)'),
        'D': ('h264', 5.3, True, 1280, 'H.264 720p ~5.3MB + buang noise malam + AQ gelap'),
        'E': ('h264', 5.3, True, 960, 'H.264 540p ~5.3MB + buang noise (bitrate lebih per piksel)'),
    }
    keys = [k.strip().upper() for k in os.environ.get('VARIANTS', 'A,B,C').split(',') if k.strip()]
    variants = [(k, *all_variants[k]) for k in keys if k in all_variants]
    with tempfile.TemporaryDirectory(prefix='status-variant-') as tmp:
        tmp = Path(tmp)
        src = tmp / 'source.bin'
        w.download_source(src)
        probe = w.probe_video(src)
        print(f'probe={probe}', flush=True)
        for key, codec, mb, denoise, height, label in variants:
            out = tmp / f'TEST-{key}.mp4'
            kbps = encode(src, out, probe, codec, mb, denoise=denoise, height=height)
            meta = w.probe_video(out)
            size = out.stat().st_size
            caption = (
                f'🧪 TEST {key}: {label}\n'
                f'Saiz fail: {size / 1_000_000:.2f} MB ({size / MB:.2f} MiB)\n'
                f'Video ~{kbps} kbps • {int(meta.get("width") or 0)}x{int(meta.get("height") or 0)} • {meta.get("fps") or 0:g}fps\n\n'
                'Save → buka editor Status WhatsApp → bandingkan MB yang WhatsApp tunjuk.'
            )
            with out.open('rb') as handle:
                w.telegram_call('sendVideo', {
                    'chat_id': str(w.CHAT_ID), 'caption': caption, 'supports_streaming': 'true',
                    'width': str(int(meta.get('width') or 0)), 'height': str(int(meta.get('height') or 0)),
                    'duration': str(max(1, int(round(meta.get('duration') or 1)))),
                }, {'video': (f'TEST-{key}.mp4', handle, 'video/mp4')}, timeout=300)
            print(f'sent {key} size={size}', flush=True)


if __name__ == '__main__':
    main()
