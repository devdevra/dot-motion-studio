import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, gzipSync, inflateSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Inflate } from 'pako';
import { decodePNG, MotionError, runPipeline } from '../lib/motion-engine.mjs';

// Independent PNG framing and Node:zlib fixtures: no engine encoder in inputs.
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function crc(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data = Buffer.alloc(0)) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8);
  result.writeUInt32BE(crc(result.subarray(4, -4)), result.length - 4);
  return result;
}
function png(compressed, { width = 1, height = 1, split } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8;
  const parts = split === undefined ? [compressed] : [compressed.subarray(0, split), compressed.subarray(split)];
  return Buffer.concat([signature, chunk('IHDR', ihdr), ...parts.map(p => chunk('IDAT', p)), chunk('IEND')]);
}
const reject = bytes => assert.throws(() => decodePNG(bytes), e => e instanceof MotionError && e.code === 'INVALID_PNG');
const plain = Buffer.from([0, 37]);
const stream = deflateSync(plain);
const pixel = [37, 37, 37, 255];

test('zlib validates actual Adler32, not a copied checksum at IDAT end', () => {
  const invalid = Buffer.from(stream); invalid[invalid.length - 1] ^= 1;
  const forged = Buffer.concat([invalid, stream.subarray(-4)]);
  assert.throws(() => inflateSync(forged)); reject(png(forged));
  const inserted = Buffer.concat([stream.subarray(0, -4), Buffer.from([0]), stream.subarray(-4)]);
  assert.throws(() => inflateSync(inserted)); reject(png(inserted));
});

for (const [name, suffix] of [
  ['zero', Buffer.from([0])],
  ['arbitrary bytes', Buffer.from([1, 255, 23, 70, 81])],
  ['copied checksum', stream.subarray(-4)],
  ['another valid zlib member', deflateSync(Buffer.from([0, 255]))],
  ['invalid apparent member', Buffer.from([0x78, 0x9c, 0x07])],
  ['large suffix across push boundaries', Buffer.alloc(8193, 0xff)],
]) test(`zlib ignores ${name} only after a validated first stream`, () => {
  const input = png(Buffer.concat([stream, suffix]));
  assert.deepEqual([...decodePNG(input).data], pixel);
  const first = runPipeline(png(stream)), second = runPipeline(input);
  assert.deepEqual(second.atlasPng, first.atlasPng);
  assert.deepEqual(second.sequenceZip, first.sequenceZip);
  assert.equal(second.atlasJSON, first.atlasJSON);
});

test('zlib boundaries remain correct at every possible IDAT split', () => {
  const compressed = Buffer.concat([stream, Buffer.from([7, 8, 9])]);
  for (let split = 0; split <= compressed.length; split++)
    assert.deepEqual([...decodePNG(png(compressed, { split })).data], pixel, `split ${split}`);
});

test('zlib rejects every truncation including all partial Adler32 lengths', () => {
  for (let end = 0; end < stream.length; end++) reject(png(stream.subarray(0, end)));
});

for (const [label, options] of [
  ['stored', { level: 0 }], ['fixed Huffman', { strategy: constants.Z_FIXED }], ['default Huffman', { level: 9 }],
]) test(`zlib accepts independent ${label} output without changing pixels`, () => {
  assert.deepEqual([...decodePNG(png(deflateSync(plain, options))).data], pixel);
});

for (const index of [5, 6]) test(`zlib rejects stored NLEN corruption at byte ${index}`, () => {
  const invalid = deflateSync(plain, { level: 0 });
  assert.equal((invalid[2] >>> 1) & 3, 0);
  invalid[index] ^= 1;
  assert.throws(() => inflateSync(invalid)); reject(png(invalid));
});

test('zlib rejects stored-block corruption after an earlier valid stored block', () => {
  // Two blocks: filter byte, then grayscale sample. Second block NLEN is wrong.
  const invalid = Buffer.from('7801000100feff00010100ffff2500270026', 'hex');
  const valid = Buffer.from(invalid); valid[11] = 0xfe;
  assert.deepEqual(inflateSync(valid), plain);
  assert.deepEqual([...decodePNG(png(valid)).data], pixel);
  assert.throws(() => inflateSync(invalid)); reject(png(invalid));
});

test('zlib rejects malformed method/window/check bits and gzip wrappers', () => {
  for (const [cmf, flg] of [[0x79, 0x18], [0x88, 0x1c], [0x78, 0x00]]) {
    const bad = Buffer.from(stream); bad[0] = cmf; bad[1] = flg; reject(png(bad));
  }
  reject(png(gzipSync(plain)));
});

test('zlib preserves explicit dictionary rejection', () => {
  const compressed = deflateSync(plain, { dictionary: Buffer.from('dictionary') });
  assert.throws(() => decodePNG(png(compressed)), e => e instanceof MotionError && e.code === 'UNSUPPORTED_PNG');
});

test('zlib rejects output shorter or longer than the IHDR scanline size', () => {
  reject(png(deflateSync(Buffer.from([0]))));
  reject(png(deflateSync(Buffer.from([0, 37, 0]))));
});

for (const size of [{ width: 1, height: 1 }, { width: 512, height: 64 }]) {
  test(`zlib aborts a 32 MiB bomb at the first excess output chunk (${size.width}x${size.height})`, () => {
    const compressed = deflateSync(Buffer.alloc(32 * 1024 * 1024));
    const expected = (size.width + 1) * size.height;
    const chunkLimit = Math.min(16384, expected + 1);
    // Only documented hooks are observed. Throwing from the engine's onData
    // stops push synchronously; neither the remaining bomb nor suffix is read.
    const originalPush = Inflate.prototype.push;
    let delivered = 0, maxChunk = 0, pushes = 0, callbackCount = 0;
    Inflate.prototype.push = function (data, final) {
      pushes++;
      assert.ok(data.length <= 1024);
      const callback = this.onData;
      this.onData = chunk => {
        delivered += chunk.length; callbackCount++; maxChunk = Math.max(maxChunk, chunk.length);
        callback(chunk);
      };
      try { return originalPush.call(this, data, final); }
      finally { this.onData = callback; }
    };
    try {
      assert.throws(() => decodePNG(png(compressed, size)), e => e instanceof MotionError && /beyond/.test(e.message));
    } finally { Inflate.prototype.push = originalPush; }
    assert.equal(pushes, 1);
    assert.ok(maxChunk <= chunkLimit);
    assert.ok(delivered > expected && delivered <= expected + chunkLimit);
    assert.equal(callbackCount, Math.floor(expected / chunkLimit) + 1);
    assert.ok(delivered < 32 * 1024 * 1024 / 100);
  });
}

// These hashes were independently recorded from the unchanged 41d95d1 engine.
test('PNG, ZIP, and JSON bytes remain identical to the pinned baseline', () => {
  const input = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGklEQVR4nGMQ1Er+z8jEzMCgY+7UkBzh+w8AIvEEzxCCzRgAAAAASUVORK5CYII=', 'base64');
  const out = runPipeline(input, { motion: { frames: 3, dx: 1, dy: -1 }, name: 'integrity-golden', fps: 12 });
  const expected = {
    atlasPng: '550a0b5961e5511faa7137af9649a7dd0769233c5d67556b03f7ec644c97ef26',
    sequenceZip: '30e0d8a7dfde0891af6ecb9b140a11363ec3a503ea20c466dc6c2da2831826e5',
    atlasJSON: '0e5b46be8cae8813007e122e03e5b6ab90cd203ad9ce30546797e91dbe31f6ed',
  };
  for (const [name, digest] of Object.entries(expected))
    assert.equal(createHash('sha256').update(out[name]).digest('hex'), digest, name);
});
