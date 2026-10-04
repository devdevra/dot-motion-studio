/** Reproduce the checked-in example with the real, unchanged Dot Motion engine. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { runPipeline, decodePNG, inspectImage, cleanAlpha } from '../../lib/motion-engine.mjs';

const dir = fileURLToPath(new URL('.', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const input = new Uint8Array(await readFile(join(dir, 'golf-ball-input.png')));
const options = {
  name: 'golf-ball', fps: 12,
  source: { kind: 'single' }, alphaThreshold: 0,
  normalize: { padding: 0, align: 'center', trim: false },
  motion: { frames: 16, dx: 12, dy: 0 }, atlasColumns: 4,
};
const result = runPipeline(input, options, true);
const again = runPipeline(input, options, true);
assert.deepEqual(result.atlasPng, again.atlasPng);
assert.equal(result.atlasJSON, again.atlasJSON);
assert.deepEqual(result.sequenceZip, again.sequenceZip);
assert.deepEqual(result.summary, {
  frameCount: 16, frameWidth: 276, frameHeight: 96,
  atlasWidth: 1104, atlasHeight: 384, fps: 12,
});
const original = cleanAlpha(decodePNG(input), 0);
const sourceInspection = inspectImage(original);
assert.ok(sourceInspection.transparentPixels > 0);
assert.ok(sourceInspection.partialAlphaPixels > 0);
const zip = unzipSync(result.sequenceZip);
assert.equal(Object.keys(zip).length, 17);
const atlas = decodePNG(result.atlasPng);
const checks = [];
const build = join(dir, '.build');
await mkdir(build, { recursive: true });
for (let i = 0; i < 16; i++) {
  const meta = result.metadata.frames[i];
  const bytes = zip[meta.filename];
  const frame = decodePNG(bytes);
  assert.equal(frame.width, 276); assert.equal(frame.height, 96);
  const inspection = inspectImage(frame);
  assert.equal(inspection.opaquePixels, sourceInspection.opaquePixels);
  assert.equal(inspection.partialAlphaPixels, sourceInspection.partialAlphaPixels);
  assert.equal(inspection.bounds.x, sourceInspection.bounds.x + i * 12);
  assert.equal(inspection.bounds.y, sourceInspection.bounds.y);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const p = (y * frame.width + x) * 4;
      const sx = x - 12 * i;
      const expected = sx >= 0 && sx < original.width
        ? original.data.subarray((y * original.width + sx) * 4, (y * original.width + sx + 1) * 4)
        : new Uint8Array(4);
      assert.deepEqual(frame.data.subarray(p, p + 4), expected);
      const a = ((meta.frame.y + y) * atlas.width + meta.frame.x + x) * 4;
      assert.deepEqual(atlas.data.subarray(a, a + 4), frame.data.subarray(p, p + 4));
    }
  }
  await writeFile(join(build, meta.filename), bytes);
  checks.push({ file: meta.filename, sha256: sha(bytes), bounds: inspection.bounds });
}
const outputs = {
  'golf-ball-atlas.png': result.atlasPng,
  'golf-ball-atlas.json': result.atlasJSON,
  'golf-ball-frames.zip': result.sequenceZip,
  'golf-ball-options.json': JSON.stringify(options, null, 2) + '\n',
};
for (const [name, bytes] of Object.entries(outputs)) await writeFile(join(dir, name), bytes);
const proof = {
  implementation: 'lib/motion-engine.mjs',
  engineSHA256: sha(await readFile(new URL('../../lib/motion-engine.mjs', import.meta.url))),
  execution: 'Actual local runPipeline; no network service or MCP call',
  input: { file: 'golf-ball-input.png', sha256: sha(input), ...result.inspection },
  options,
  summary: result.summary,
  verified: { deterministicExport: true, pixelIdenticalTranslation: true,
    transparentPixelsPreserved: true, atlasMatchesSequence: true,
    pngSequenceCount: 16, zipEntryCount: 17 },
  outputs: Object.fromEntries(Object.entries(outputs).map(([name, bytes]) => [name, {
    bytes: Buffer.byteLength(bytes), sha256: sha(bytes),
  }])),
  frames: checks,
};
await writeFile(join(dir, 'engine-verification.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ summary: result.summary, inspection: result.inspection, verified: proof.verified, outputs: proof.outputs }, null, 2));
