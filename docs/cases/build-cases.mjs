#!/usr/bin/env node
/** Reproduce 3 cases using the unchanged production motion engine. No generated poses here. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { runPipeline, decodePNG, inspectImage, extractFrames, cleanAlpha } from '../../lib/motion-engine.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const hash = b => createHash('sha256').update(b).digest('hex');
const cases = [
  { id: 'robot-walk', title: '로봇 제자리 걷기', fps: 8 },
  { id: 'mascot-expression', title: '마스코트 표정 전환', fps: 8 },
  { id: 'flag-wave', title: '깃발 펄럭임', fps: 12 },
];
const verification = {
  scope: 'Local production engine runPipeline; not live MCP or UI verification',
  source: 'Original AI-generated pre-drawn frame sheets; generation is separate from this engine',
  engine: { path: 'lib/motion-engine.mjs', sha256: hash(await readFile(resolve(ROOT, '../../lib/motion-engine.mjs'))) },
  options: 'Explicit 4×2 row-major grid; preserve 128×128 cells and all source anchors; no trimming, no translation, no interpolation',
  cases: [],
};
for (const c of cases) {
  const inputPath = `inputs/${c.id}.png`, input = await readFile(resolve(ROOT, inputPath));
  const image = decodePNG(new Uint8Array(input));
  assert.equal(image.width, 512); assert.equal(image.height, 256);
  const options = { name: c.id, fps: c.fps, source: { kind: 'grid', columns: 4, rows: 2, count: 8, margin: 0, spacing: 0 }, alphaThreshold: 0,
    normalize: { trim: false, padding: 0, width: 128, height: 128, align: 'center' }, atlasColumns: 4 };
  const out = runPipeline(new Uint8Array(input), options, true);
  assert.equal(out.summary.frameCount, 8); assert.equal(out.summary.frameWidth, 128); assert.equal(out.summary.frameHeight, 128);
  assert.equal(out.summary.atlasWidth, 512); assert.equal(out.summary.atlasHeight, 256);
  assert.equal(out.metadata.meta.fps, c.fps);
  const outDir = resolve(ROOT, 'outputs', c.id), seqDir = resolve(outDir, 'frames');
  await mkdir(seqDir, { recursive: true });
  const files = {
    [`${c.id}-atlas.png`]: out.atlasPng,
    [`${c.id}-atlas.json`]: out.atlasJSON + '\n',
    [`${c.id}-frames.zip`]: out.sequenceZip,
    [`${c.id}-options.json`]: JSON.stringify(options, null, 2) + '\n',
  };
  for (const [name, data] of Object.entries(files)) await writeFile(resolve(outDir, name), data);
  const zipEntries = unzipSync(out.sequenceZip), raw = extractFrames(image, options.source);
  const actualAtlas = decodePNG(out.atlasPng);
  const atlasFrames = extractFrames(actualAtlas, options.source);
  const frames = [];
  for (let i = 0; i < 8; i++) {
    const name = out.metadata.frames[i].filename, bytes = zipEntries[name];
    assert(bytes, `ZIP contains ${name}`);
    const actual = decodePNG(bytes), expected = cleanAlpha(raw[i], 0);
    assert.deepEqual(actual.data, expected.data, `frame ${i+1}: pixel-identical source cell after alpha=0 canonicalization`);
    assert.deepEqual(atlasFrames[i].data, actual.data, `atlas frame ${i+1} matches PNG`);
    assert.equal(out.metadata.frames[i].frame.x, (i % 4) * 128);
    assert.equal(out.metadata.frames[i].frame.y, Math.floor(i / 4) * 128);
    await writeFile(resolve(seqDir, name), bytes);
    let differingPixels = 0;
    const next = cleanAlpha(raw[(i+1)%8], 0);
    for(let p = 0; p < actual.data.length; p += 4) if(actual.data.subarray(p,p+4).some((v,k) => v !== next.data[p+k])) differingPixels++;
    frames.push({ name, sha256: hash(bytes), bytes: bytes.length, inspection: inspectImage(actual), nextFrameDifferentPixels: differingPixels,
      sourceCellPixelMatch: true, atlasCellPixelMatch: true, anchorPreservedByEngine: true });
  }
  assert.equal(Object.keys(zipEntries).length, 9);
  verification.cases.push({ ...c, input: { path: inputPath, bytes: input.length, sha256: hash(input), inspection: out.inspection }, options,
    summary: out.summary, files: Object.fromEntries(Object.entries(files).map(([n,b])=>[n,{bytes:Buffer.byteLength(b),sha256:hash(b)}])), frames,
    checks: { frameOrder: 'row-major, left-to-right then next row; exact pixel comparison passed',
      alphaPreserved: 'All nonzero alpha preserved. Original invisible RGB cleared only at alpha=0.',
      loop: 'Metadata loop=true is a playback hint; source-pose continuity must be reviewed visually, not guaranteed by extraction.' } });
}
await writeFile(resolve(ROOT,'engine-verification.json'), JSON.stringify(verification, null, 2)+'\n');
console.log(JSON.stringify(verification.cases.map(c=>({id:c.id,...c.summary,inputSha256:c.input.sha256})),null,2));
