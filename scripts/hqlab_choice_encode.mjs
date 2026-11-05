// Owner-only HQ Lab: produce exactly ONE requested original formula.
import { copyFile, writeFile } from 'node:fs/promises';
import { prepareHqLabChoice } from '../src/hq-lab-choice.js';

const [sourcePath, outputPath, metadataPath, choice] = process.argv.slice(2);
const supported = new Set(['cplus', 'premiumplus', 'premiumplus-v2']);
if (!sourcePath || !outputPath || !metadataPath || !supported.has(choice)) {
  console.error('Usage: node scripts/hqlab_choice_encode.mjs <source> <output.mp4> <meta.json> <choice>');
  process.exitCode = 2;
} else {
  let prepared;
  try {
    prepared = await prepareHqLabChoice({
      platform: 'telegram',
      localInputPath: sourcePath,
      selectedSlug: choice,
    });
    const selected = prepared.results?.[0];
    if (prepared.results?.length !== 1 || !selected?.ok) {
      throw new Error('The selected HQ Lab formula failed: ' +
        String(selected?.error || 'no video result'));
    }
    await copyFile(selected.filePath, outputPath);
    await writeFile(metadataPath, JSON.stringify({
      name: selected.name,
      id: selected.id,
      videoKbps: selected.videoKbps,
      size: selected.size,
      elapsedMs: selected.elapsedMs,
      width: selected.output?.width,
      height: selected.output?.height,
      fps: selected.output?.fps,
      audio: Boolean(selected.output?.hasAudio),
    }));
    console.log('OWNER_HQ_LAB_CHOICE_OK ' + selected.slug);
  } catch (error) {
    console.error('Owner HQ Lab choice failed:', error?.message);
    process.exitCode = 1;
  } finally {
    if (prepared?.cleanup) await prepared.cleanup();
  }
}
