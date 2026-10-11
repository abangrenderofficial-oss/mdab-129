import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';

const temp = mkdtempSync(path.join(tmpdir(), 'mediax-qa-'));
try {
  for (const [w, h] of [[360, 640], [640, 360]]) {
    const name = path.join(temp, w + 'x' + h + '.mp4');
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi',
      '-i', 'testsrc2=s=' + w + 'x' + h + ':r=24',
      '-f', 'lavfi', '-i', 'sine=f=440', '-t', '1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', name], { timeout: 60000 });
    const data = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams',
      '-of', 'json', name], { encoding: 'utf8' }));
    const video = data.streams.find(x => x.codec_type === 'video');
    const audio = data.streams.find(x => x.codec_type === 'audio');
    if (video?.width !== w || video?.height !== h || video?.codec_name !== 'h264'
      || audio?.codec_name !== 'aac') throw new Error('Failed aspect/audio test ' + w + 'x' + h);
    console.log('MEDIAX_ASPECT_AUDIO_PASS', w + 'x' + h);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
