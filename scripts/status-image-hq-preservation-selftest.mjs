import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { prepareWhatsAppStatusImageHQ } from '../src/status-image-hq.js';

const execFileAsync = promisify(execFile);
const folder = await mkdtemp(join(tmpdir(), 'mediax-image-hq-test-'));
const original = join(folder, '1183x2560.jpg');
let server;
let prepared;
try {
  // Intentionally use an odd portrait width to guard against silent resize.
  await execFileAsync(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=1183x2560:rate=1',
    '-frames:v', '1', '-pix_fmt', 'yuvj444p', '-q:v', '5', '-threads', '1', original,
  ], { timeout: 45000 });
  const before = await readFile(original);
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(before.length) });
    res.end(before);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/photo.jpg`;
  prepared = await prepareWhatsAppStatusImageHQ({ image: { url, ext: 'jpg' } });
  const after = await readFile(prepared.filePath);
  assert.deepEqual(after, before, 'Premium+ HQ must not recompress or resize an uploaded JPEG');
  assert.equal(prepared.size, before.length);
  console.log('MEDIA_X_PREMIUM_IMAGE_HQ_PRESERVE_OK', JSON.stringify({
    sourceWidth:1183, sourceHeight:2560, bytes:after.length,
    byteIdentical:true, recompressed:false, downscaled:false,
  }));
} finally {
  if (prepared?.cleanup) await prepared.cleanup();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(folder, { recursive: true, force: true });
}
