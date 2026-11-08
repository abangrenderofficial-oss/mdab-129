import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { prepareWhatsAppStatusImageHQ } from '../src/status-image-hq.js';

const exec = promisify(execFile);
const dir = await mkdtemp(path.join(tmpdir(), 'mediax-image-format-test-'));
const originals = new Map();
let server;
try {
  for (const ext of ['jpg','png','webp']) {
    const output = path.join(dir, `original.${ext}`);
    const args = ['-y','-hide_banner','-loglevel','error',
      '-f','lavfi','-i','testsrc=size=983x1747:rate=1','-frames:v','1',
      '-threads','1'];
    if (ext === 'jpg') args.push('-pix_fmt','yuvj444p','-q:v','2');
    if (ext === 'webp') args.push('-c:v','libwebp','-quality','100','-lossless','1');
    await exec(ffmpeg, [...args, output], { timeout: 60000 });
    originals.set(ext, await readFile(output));
  }
  server = createServer((req,res)=>{
    const ext = String(req.url||'').replace(/^\//,'').replace(/^original\./,'');
    const bytes = originals.get(ext);
    if (!bytes) {res.writeHead(404);res.end();return}
    res.writeHead(200, {
      'Content-Type': ext === 'jpg' ? 'image/jpeg' : `image/${ext}`,
      'Content-Length': String(bytes.length),
    });
    res.end(bytes);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  for (const ext of originals.keys()) {
    const url = `http://127.0.0.1:${server.address().port}/original.${ext}`;
    const prepared = await prepareWhatsAppStatusImageHQ({ image: { url, ext } });
    try {
      const output = await readFile(prepared.filePath);
      const source = originals.get(ext);
      assert.deepEqual(output, source, `${ext}: original image bytes changed`);
      assert.equal(prepared.fileName, `status-hq.${ext}`);
      assert.equal(prepared.sourcePreserved, true);
      assert.equal(prepared.size, source.length);
      console.log('MEDIAX_IMAGE_ORIGINAL_FORMAT_PRESERVED', JSON.stringify({
        format: ext, sourceBytes: source.length, outputBytes: output.length,
        byteIdentical: true, dimensionChanged: false, recompressed: false,
      }));
    } finally { await prepared.cleanup(); }
  }
} finally {
  if (server) await new Promise(resolve=>server.close(resolve));
  await rm(dir,{recursive:true,force:true});
}
