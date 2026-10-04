#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { runPipeline, decodePNG, inspectImage, extractFrames, LIMITS } from '../../../lib/motion-engine.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const sha = b => createHash('sha256').update(b).digest('hex');
const engineBytes = await readFile(resolve(ROOT, '../../../lib/motion-engine.mjs'));
const input = await readFile(resolve(ROOT, 'typography-source.png'));
const options = { name: 'typography', fps: 8,
  source: { kind: 'grid', columns: 4, rows: 4, count: 16, margin: 0, spacing: 0 },
  alphaThreshold: 0,
  normalize: { trim: false, padding: 0, width: 240, height: 128, align: 'center' },
  atlasColumns: 4 };
const out = runPipeline(new Uint8Array(input), options, true);
assert.deepEqual(out.summary, { frameCount: 16, frameWidth: 240, frameHeight: 128, atlasWidth: 960, atlasHeight: 512, fps: 8 });
const source = decodePNG(input), cells = extractFrames(source, options.source);
const atlas = decodePNG(out.atlasPng), atlasCells = extractFrames(atlas, options.source);
const entries = unzipSync(out.sequenceZip);
assert.equal(Object.keys(entries).length,17);
assert.deepEqual(JSON.parse(new TextDecoder().decode(entries['typography-atlas.json'])),out.metadata);
await mkdir(resolve(ROOT, '.build/frames'), { recursive: true });
const frames = [];
for(let i=0; i<16; i++) {
  const name = out.metadata.frames[i].filename, bytes = entries[name], actual = decodePNG(bytes);
  assert.deepEqual(actual.data, cells[i].data, `source cell ${i+1} exact RGBA match`);
  assert.deepEqual(actual.data, atlasCells[i].data, `atlas cell ${i+1} exact RGBA match`);
  const inspection = inspectImage(actual);
  assert(inspection.transparentPixels>0 && inspection.partialAlphaPixels>0);
  assert.equal(out.metadata.frames[i].frame.x, (i%4)*240);
  assert.equal(out.metadata.frames[i].frame.y, Math.floor(i/4)*128);
  assert.equal(out.metadata.frames[i].duration,125);
  await writeFile(resolve(ROOT,'.build/frames',name),bytes);
  frames.push({name,bytes:bytes.length,sha256:sha(bytes),inspection,sourcePixelMatch:true,atlasPixelMatch:true});
}
const products = {'typography-atlas.png':out.atlasPng,'typography-atlas.json':out.atlasJSON+'\n',
  'typography-frames.zip':out.sequenceZip,'typography-options.json':JSON.stringify(options,null,2)+'\n'};
for(const [name,bytes] of Object.entries(products)) await writeFile(resolve(ROOT,name),bytes);
const totalPixels = 16*240*128+960*512;
assert(totalPixels<=LIMITS.maxOutputPixels && input.length<=LIMITS.maxInputBytes);
const proof = {scope:'Actual unchanged local production runPipeline; not live MCP, UI capture, or native engine video export',
  engine:{path:'lib/motion-engine.mjs',sha256:sha(engineBytes)}, options, limits:LIMITS,
  input:{bytes:input.length,sha256:sha(input),inspection:out.inspection},summary:out.summary,
  combinedFrameAndAtlasPixels:totalPixels,
  checks:{exactRgbaPixelMatch:true,rowMajorFrameOrder:true,alphaPreserved:true,fixedCanvasAnchorPreserved:true,
    zipEntryCount:17,resetLoopIntentional:true},
  products:Object.fromEntries(Object.entries(products).map(([n,b])=>[n,{bytes:Buffer.byteLength(b),sha256:sha(b)}])),frames};
await writeFile(resolve(ROOT,'engine-verification.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({summary:out.summary,combinedFrameAndAtlasPixels:totalPixels,engineSha256:sha(engineBytes)},null,2));
