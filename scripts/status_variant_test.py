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


def encode(src, out, probe, codec, total_mb, denoise=False, height=1280, sharpen=False, tuned=False):
    dur = max(1.0, probe['duration'])
    video_kbps = max(300, int(total_mb * 8 * 1_000_000 / dur / 1000 * 0.96) - AUDIO_KBPS)
    scale = w.upload_scale_filter(height, height * 9 // 16)
    sharp = 'unsharp=5:5:0.55:5:5:0.0' if sharpen else None
    filters = [
        ('hqdn3d=3:2:6:4.5' if denoise == 'medium' else 'hqdn3d=2:1.5:4:3') if denoise else None,
        scale, 'setsar=1', w.upload_tonemap_filter(probe), sharp, w.upload_fps_filter(probe),
    ]
    vf = ','.join(f for f in filters if f)
    common_v = ['-vf', vf, '-pix_fmt', 'yuv420p',
                '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']
    rate = ['-b:v', f'{video_kbps}k', '-maxrate', f'{int(video_kbps * 1.5)}k', '-bufsize', f'{video_kbps * 2}k']
    audio = ['-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', f'{AUDIO_KBPS}k']
    tail = ['-movflags', '+faststart', '-map_metadata', '-1', str(out)]
    base = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', str(src), '-map', '0:v:0']
    if codec == 'h264':
        if denoise:
            x264 = ['-x264-params', 'aq-mode=3:aq-strength=1.0:deblock=1,1']
        elif tuned:
            x264 = ['-tune', 'film', '-x264-params', 'aq-mode=3:psy-rd=1.0,0.15']
        else:
            x264 = []
        venc = ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level:v', '4.0' if height > 1280 else '3.1', *rate, *x264,
                '-passlogfile', str(out) + '.log']
        w.run(base + common_v + venc + ['-pass', '1', '-an', '-f', 'mp4', os.devnull], timeout=1500)
        w.run(base + ['-map', '0:a:0?'] + common_v + venc + ['-pass', '2'] + audio + tail, timeout=1500)
    else:
        stats = str(out) + '.x265'
        venc = ['-c:v', 'libx265', '-preset', 'slow', *rate, '-tag:v', 'hvc1']
        w.run(base + common_v + venc + ['-x265-params', f'pass=1:stats={stats}', '-an', '-f', 'mp4', os.devnull], timeout=1500)
        w.run(base + ['-map', '0:a:0?'] + common_v + venc + ['-x265-params', f'pass=2:stats={stats}'] + audio + tail, timeout=1500)
    return video_kbps


def encode_statusdrop(src, out, extra=''):
    # Exact StatusDrop (github.com/Shamanthnp1/WAstatus) "WhatsApp_Spec" encode:
    # 1080x1920 canvas, x264 High@4.0 CRF23 maxrate 3800k, no SEI, 30fps cap,
    # <=29s per clip, <16MB. Their claim: WhatsApp passes it through untouched
    # when posted via Gallery-HD-to-chat then forward to Status.
    vf = ("scale=w=1080:h=1920:force_original_aspect_ratio=decrease,"
          "pad=1080:1920:(ow-iw)/2:(oh-ih)/2,scale=trunc(iw/2)*2:trunc(ih/2)*2")
    if extra:
        vf += ',' + extra
    w.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', str(src), '-t', '29',
           '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-c:v', 'libx264', '-preset', 'medium',
           '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-color_primaries', 'bt470bg',
           '-color_trc', 'bt709', '-colorspace', 'bt470bg', '-crf', '23', '-maxrate', '3800k',
           '-bufsize', '5700k', '-g', '250', '-profile:v', 'high', '-level:v', '4.0',
           '-x264-params', 'sei=0', '-r', '30', '-c:a', 'aac', '-ar', '44100', '-ac', '2',
           '-b:a', '128k', '-brand', 'isom', '-movflags', '+faststart', '-f', 'mp4', str(out)], timeout=1500)


def main():
    w.require_config()
    all_variants = {
        'A': ('h264', 5.3, False, 1280, 'H.264 720p ~5.3MB (bawah sasaran WhatsApp)'),
        'B': ('hevc', 5.3, False, 1280, 'HEVC 720p ~5.3MB (uji teori HEVC)'),
        'C': ('h264', 9.0, False, 1280, 'H.264 720p ~9MB (lebih sasaran)'),
        'D': ('h264', 5.3, True, 1280, 'H.264 720p ~5.3MB + buang noise malam + AQ gelap'),
        'E': ('h264', 5.3, True, 960, 'H.264 540p ~5.3MB + buang noise (bitrate lebih per piksel)'),
        'F': ('h264', 9.0, False, 1280, 'H.264 720p ~9MB + sharpen ringan + tune film', True),
        'G': ('h264', 9.0, False, 1920, 'H.264 1080p ~9MB + tune film (tiada resize loss)', True, False),
        'S': ('h264', 9.5, False, 1024, '576x1024 BERSIH ~2.5Mbps (tiru saiz video TikTok)'),
        'T': ('h264', 9.5, 'medium', 1024, '576x1024 + licinkan sederhana ~2.5Mbps (tiru rupa TikTok)'),
        'H': ('h264', 25.0, False, 1280, 'Formula F tapi ~25MB (sumber lebih bersih untuk WhatsApp)', True),
    }
    keys = [k.strip().upper() for k in os.environ.get('VARIANTS', 'A,B,C').split(',') if k.strip()]
    variants = []
    prod = 'P' in keys
    for k in keys:
        if k not in all_variants:
            continue
        v = all_variants[k]
        codec, mb, denoise, height, label = v[:5]
        tuned = v[5] if len(v) > 5 else False
        sharpen = v[6] if len(v) > 6 else tuned
        variants.append((k, codec, mb, denoise, height, label, tuned, sharpen))
    with tempfile.TemporaryDirectory(prefix='status-variant-') as tmp:
        tmp = Path(tmp)
        src = tmp / 'source.bin'
        w.download_source(src)
        probe = w.probe_video(src)
        print(f'probe={probe}', flush=True)
        if os.environ.get('KEEP_DIR') and os.environ.get('KEEP_SOURCE') == '1':
            import shutil
            Path(os.environ['KEEP_DIR']).mkdir(parents=True, exist_ok=True)
            shutil.copy(src, Path(os.environ['KEEP_DIR']) / 'source.mp4')
        if 'TDS' in keys:
            variants.insert(0, ('TDS', 'statusdrop', 0, False, 1920, 'U + denoise temporal + sharpen sangat halus (lawan blur)', False, False))
        if 'TD' in keys:
            variants.insert(0, ('TD', 'statusdrop', 0, False, 1920, 'U + denoise TEMPORAL sahaja (tak sentuh ketajaman)', False, False))
        for vk, vlabel in [('V3', 'U + sharpen ringan + grain statik ringan'), ('V2', 'U + sharpen ringan sahaja'), ('V1', 'U + grain statik ringan sahaja')]:
            if vk in keys:
                variants.insert(0, (vk, 'statusdrop', 0, False, 1920, vlabel, False, False))
        if 'U' in keys:
            variants.insert(0, ('U', 'statusdrop', 0, False, 1920, 'SPEC STATUSDROP: 1080x1920 H.264 High CRF23 <=3.8Mbps, 29s, <16MB', False, False))
        if 'R' in keys:
            variants.insert(0, ('R', 'prod-clean', 0, False, 1280, 'BERSIH: tanpa sharpen, tanpa buang noise, tanpa tune (encode asli sahaja)', False, False))
        if 'Q' in keys:

            variants.insert(0, ('Q', 'prod', 0, True, 1280, 'P + buang noise ringan (worker sebenar)', False, False))
        if prod:
            variants.insert(0, ('P', 'prod', 0, False, 1280, 'FORMULA AKHIR (worker sebenar, upload-v4 H.264)', False, False))
        for key, codec, mb, denoise, height, label, tuned, sharpen in variants:
            out = tmp / f'TEST-{key}.mp4'
            if codec == 'statusdrop':
                encode_statusdrop(src, out, {'V1': 'noise=alls=4:allf=u', 'V2': 'unsharp=5:5:0.4:5:5:0.0', 'V3': 'unsharp=5:5:0.4:5:5:0.0,noise=alls=3:allf=u', 'TD': 'hqdn3d=0:0:3:3', 'TDS': 'hqdn3d=0:0:3:3,unsharp=5:5:0.25:5:5:0.0'}.get(key, ''))
                kbps = int(out.stat().st_size * 8 / 29 / 1000) - AUDIO_KBPS
            elif codec == 'prod-clean':
                w.UPLOAD_ENHANCE = False
                w.encode_status(src, out, probe, android=False)
                w.UPLOAD_ENHANCE = True
                kbps = int(out.stat().st_size * 8 / max(1.0, probe['duration']) / 1000) - AUDIO_KBPS
            elif codec == 'prod':
                w.UPLOAD_DENOISE = bool(denoise)
                w.encode_status(src, out, probe, android=False)
                kbps = int(out.stat().st_size * 8 / max(1.0, probe['duration']) / 1000) - AUDIO_KBPS
            else:
                kbps = encode(src, out, probe, codec, mb, denoise=denoise, height=height, sharpen=sharpen, tuned=tuned)
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
            keep = os.environ.get('KEEP_DIR')
            if keep:
                Path(keep).mkdir(parents=True, exist_ok=True)
                import shutil
                shutil.copy(out, Path(keep) / out.name)


if __name__ == '__main__':
    main()
