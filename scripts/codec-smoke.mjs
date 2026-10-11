import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
const codecs = String(execFileSync(ffmpeg, ['-encoders'], { encoding: 'utf8', timeout: 20000 }));
for (const encoder of ['libx264', 'libx265', 'aac']) {
  if (!codecs.includes(encoder)) throw new Error('Missing media encoder: ' + encoder);
}
console.log('MEDIAX_CODEC_SMOKE_OK');
