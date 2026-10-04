/**
 * Original deterministic pixel-motion engine. No network, filesystem, DOM, or Node APIs.
 * PNG container/filter code and all pixel operations are original; pako validates
 * zlib input, and fflate supplies deterministic DEFLATE and ZIP encoding. Static PNG only; no semantic background removal.
 */
import { zlibSync, zipSync, strToU8 } from 'fflate';
import { Inflate } from 'pako';

export const LIMITS = Object.freeze({
  maxInputBytes: 2 * 1024 * 1024,
  maxInputPixels: 1_000_000,
  maxOutputPixels: 1_000_000,
  maxDimension: 4096,
  maxFrames: 64,
  maxChunks: 4096,
});
const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

export class MotionError extends Error {
  constructor(code, message) { super(message); this.name = 'MotionError'; this.code = code; }
}
function fail(code, message) { throw new MotionError(code, message); }
function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail('INVALID_OPTION', `${label} must be an integer from ${min} to ${max}.`);
  return value;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OPTION', `${label} must be an object.`);
  return value;
}
function keys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('INVALID_OPTION', `Unknown ${label} option: ${key}.`);
}
function defaultIfUndefined(value, fallback) {
  return value === undefined ? fallback : value;
}
function bool(value, label) {
  if (typeof value !== 'boolean') fail('INVALID_OPTION', `${label} must be a boolean.`);
  return value;
}
function checkedPixels(width, height, cap = LIMITS.maxOutputPixels) {
  integer(width, 'width', 1, LIMITS.maxDimension);
  integer(height, 'height', 1, LIMITS.maxDimension);
  if (width * height > cap) fail('PIXEL_LIMIT', `Image pixel count exceeds ${cap.toLocaleString('en-US')}.`);
  return width * height;
}
function rgba(image) {
  object(image, 'image');
  const pixels = checkedPixels(image.width, image.height);
  if (!(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) || image.data.length !== pixels * 4)
    fail('INVALID_IMAGE', 'Image data must contain exactly width × height × 4 RGBA bytes.');
  return image;
}
function frameList(frames) {
  if (!Array.isArray(frames)) fail('INVALID_OPTION', 'frames must be an array.');
  integer(frames.length, 'frame count', 1, LIMITS.maxFrames);
  let total = 0;
  for (const frame of frames) { rgba(frame); total += frame.width * frame.height; }
  if (total > LIMITS.maxOutputPixels) fail('PIXEL_LIMIT', 'Combined frame pixels exceed the output pixel limit.');
  return total;
}
function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function read32(data, offset) { return (data[offset] * 0x1000000 + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3]) >>> 0; }
function write32(data, offset, value) {
  data[offset] = value >>> 24; data[offset + 1] = value >>> 16;
  data[offset + 2] = value >>> 8; data[offset + 3] = value;
}
function concat(parts, length = parts.reduce((n, part) => n + part.length, 0)) {
  const result = new Uint8Array(length);
  let pos = 0;
  for (const part of parts) { result.set(part, pos); pos += part.length; }
  return result;
}
function pngStructure(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('INVALID_PNG', 'PNG input must be a Uint8Array.');
  if (bytes.length > LIMITS.maxInputBytes) fail('INPUT_LIMIT', 'PNG input must be 2 MiB or smaller.');
  if (bytes.length < 45 || !SIGNATURE.every((v, i) => bytes[i] === v)) fail('INVALID_PNG', 'Input is not a valid PNG.');
  let offset = 8, chunks = 0, header, palette, transparency, ended = false;
  let sawData = false, dataClosed = false, compressedLength = 0;
  const dataParts = [];
  while (offset < bytes.length) {
    if (++chunks > LIMITS.maxChunks) fail('INVALID_PNG', 'PNG has too many chunks.');
    if (offset + 12 > bytes.length) fail('INVALID_PNG', 'PNG chunk header is truncated.');
    const length = read32(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) fail('INVALID_PNG', 'PNG chunk is truncated.');
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (!/^[A-Za-z]{4}$/.test(type) || /[a-z]/.test(type[2])) fail('INVALID_PNG', 'PNG chunk type is invalid.');
    if (crc32(bytes, offset + 4, end - 4) !== read32(bytes, end - 4)) fail('INVALID_PNG', `PNG ${type} checksum is invalid.`);
    const data = bytes.subarray(offset + 8, end - 4);
    if (chunks === 1 && type !== 'IHDR') fail('INVALID_PNG', 'PNG must start with IHDR.');
    if (type === 'IHDR') {
      if (header || length !== 13) fail('INVALID_PNG', 'PNG IHDR is invalid.');
      const width = read32(data, 0), height = read32(data, 4), bitDepth = data[8], colorType = data[9];
      checkedPixels(width, height, LIMITS.maxInputPixels); // Checked before inflate or pixel allocation.
      if (!DEPTHS[colorType]?.includes(bitDepth)) fail('UNSUPPORTED_PNG', 'Unsupported PNG color type or bit depth.');
      if (data[10] !== 0 || data[11] !== 0) fail('UNSUPPORTED_PNG', 'Unsupported PNG compression or filter method.');
      if (data[12] !== 0) fail('UNSUPPORTED_PNG', 'Interlaced PNGs are not supported; export a non-interlaced PNG.');
      header = { width, height, bitDepth, colorType, pixelCount: width * height, interlaced: false };
    } else if (type === 'PLTE') {
      if (palette || sawData || transparency || !length || length % 3 || length > 768 || [0, 4].includes(header.colorType))
        fail('INVALID_PNG', 'PNG palette is invalid.');
      if (header.colorType === 3 && length / 3 > 2 ** header.bitDepth) fail('INVALID_PNG', 'PNG palette exceeds bit depth.');
      palette = data;
    } else if (type === 'tRNS') {
      if (transparency || sawData || [4, 6].includes(header.colorType)) fail('INVALID_PNG', 'PNG transparency chunk is invalid.');
      const c = header.colorType;
      if ((c === 0 && length !== 2) || (c === 2 && length !== 6) || (c === 3 && (!palette || !length || length > palette.length / 3)))
        fail('INVALID_PNG', 'PNG transparency values are invalid.');
      if (c !== 3) for (let k = 0; k < length; k += 2)
        if (((data[k] << 8) | data[k + 1]) >= 2 ** header.bitDepth) fail('INVALID_PNG', 'PNG transparency sample exceeds bit depth.');
      transparency = data;
    } else if (type === 'IDAT') {
      if (dataClosed || (header.colorType === 3 && !palette)) fail('INVALID_PNG', 'PNG image data order is invalid.');
      sawData = true; compressedLength += length; dataParts.push(data);
    } else if (type === 'IEND') {
      if (length !== 0 || !sawData || compressedLength < 6 || end !== bytes.length) fail('INVALID_PNG', 'PNG ending is invalid.');
      ended = true;
    } else {
      if (['acTL', 'fcTL', 'fdAT'].includes(type)) fail('UNSUPPORTED_PNG', 'Animated PNG input is not supported; upload a static PNG or sprite sheet.');
      if (type[0] === type[0].toUpperCase()) fail('UNSUPPORTED_PNG', `Unsupported critical PNG chunk ${type}.`);
    }
    if (sawData && type !== 'IDAT') dataClosed = true;
    offset = end;
  }
  if (!ended) fail('INVALID_PNG', 'PNG is missing IEND.');
  return { ...header, palette, transparency, dataParts, compressedLength,
    hasAlphaChannel: [4, 6].includes(header.colorType), hasTransparencyMetadata: !!transparency };
}

/** Validate the entire PNG container without inflating image data. */
export function inspectPNG(bytes) {
  const { palette, transparency, dataParts, compressedLength, ...header } = pngStructure(bytes);
  return header;
}

/** Validate one complete zlib stream; PNG permits unused bytes after that stream.
 * Pako's public streaming API validates DEFLATE and the actual Adler-32 boundary.
 * Only fixed-size output chunks are produced before our IHDR bound is checked.
 */
function boundedInflate(compressed, expectedLength) {
  const cmf = compressed[0], flg = compressed[1];
  if (compressed.length < 6 || (cmf & 15) !== 8 || (cmf >>> 4) > 7 || ((cmf << 8) | flg) % 31)
    fail('INVALID_PNG', 'PNG zlib header is invalid.');
  if (flg & 32) fail('UNSUPPORTED_PNG', 'PNG zlib dictionaries are not supported.');
  const result = new Uint8Array(expectedLength);
  let written = 0;
  try {
    // Use the declared window, not a permissive 32 KiB default. Explicit positive
    // windowBits also disables gzip autodetection. Tiny images get a tiny chunk.
    const inflater = new Inflate({ windowBits: (cmf >>> 4) + 8, chunkSize: Math.min(16384, expectedLength + 1) });
    inflater.onData = (chunk) => {
      if (written + chunk.length > expectedLength) fail('INVALID_PNG', 'PNG expands beyond the size declared in IHDR.');
      result.set(chunk, written); written += chunk.length;
    };
    // Input is already <= 2 MiB. Stop at the first verified zlib end, including
    // when unused PNG IDAT suffix bytes are present or resemble another stream.
    for (let i = 0; i < compressed.length && !inflater.ended; i += 1024) {
      if (!inflater.push(compressed.subarray(i, i + 1024), i + 1024 >= compressed.length))
        fail('INVALID_PNG', 'PNG compressed data is invalid or truncated.');
    }
    if (!inflater.ended || inflater.err) fail('INVALID_PNG', 'PNG compressed data is invalid or truncated.');
  } catch (error) {
    if (error instanceof MotionError) throw error;
    fail('INVALID_PNG', 'PNG compressed data is invalid or truncated.');
  }
  if (written !== expectedLength) fail('INVALID_PNG', 'PNG decompressed size does not match IHDR.');
  return result;
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode non-interlaced PNG to unpremultiplied 8-bit RGBA. 16-bit samples use the high byte. */
export function decodePNG(bytes) {
  const h = pngStructure(bytes);
  const channels = CHANNELS[h.colorType], bitsPerPixel = channels * h.bitDepth;
  const rowBytes = Math.ceil(h.width * bitsPerPixel / 8), bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const scan = boundedInflate(concat(h.dataParts, h.compressedLength), (rowBytes + 1) * h.height);
  const output = new Uint8Array(h.pixelCount * 4);
  let previous = new Uint8Array(rowBytes), current = new Uint8Array(rowBytes);
  const readSample = (row, sample) => {
    if (h.bitDepth === 16) return (row[sample * 2] << 8) | row[sample * 2 + 1];
    if (h.bitDepth === 8) return row[sample];
    const bit = sample * h.bitDepth;
    return (row[bit >>> 3] >>> (8 - h.bitDepth - (bit & 7))) & ((1 << h.bitDepth) - 1);
  };
  const to8 = (value) => h.bitDepth === 16 ? value >>> 8 : h.bitDepth === 8 ? value : Math.round(value * 255 / ((1 << h.bitDepth) - 1));
  const transparentSamples = h.transparency && h.colorType !== 3
    ? Array.from({ length: h.transparency.length / 2 }, (_, i) => (h.transparency[i * 2] << 8) | h.transparency[i * 2 + 1]) : null;
  for (let y = 0; y < h.height; y++) {
    const pos = y * (rowBytes + 1), filter = scan[pos];
    if (filter > 4) fail('INVALID_PNG', 'PNG scanline filter is invalid.');
    for (let k = 0; k < rowBytes; k++) {
      const left = k >= bpp ? current[k - bpp] : 0, up = previous[k], upperLeft = k >= bpp ? previous[k - bpp] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
      current[k] = (scan[pos + 1 + k] + prediction) & 255;
    }
    for (let x = 0; x < h.width; x++) {
      const dest = (y * h.width + x) * 4, sample = x * channels;
      const a = readSample(current, sample);
      let r, g, b, alpha = 255;
      if (h.colorType === 3) {
        if (a * 3 >= h.palette.length) fail('INVALID_PNG', 'PNG pixel references an invalid palette entry.');
        r = h.palette[a * 3]; g = h.palette[a * 3 + 1]; b = h.palette[a * 3 + 2];
        alpha = h.transparency && a < h.transparency.length ? h.transparency[a] : 255;
      } else if (h.colorType === 0 || h.colorType === 4) {
        r = g = b = to8(a);
        if (h.colorType === 4) alpha = to8(readSample(current, sample + 1));
        else if (transparentSamples && a === transparentSamples[0]) alpha = 0;
      } else {
        const green = readSample(current, sample + 1), blue = readSample(current, sample + 2);
        r = to8(a); g = to8(green); b = to8(blue);
        if (h.colorType === 6) alpha = to8(readSample(current, sample + 3));
        else if (transparentSamples && a === transparentSamples[0] && green === transparentSamples[1] && blue === transparentSamples[2]) alpha = 0;
      }
      output[dest] = r; output[dest + 1] = g; output[dest + 2] = b; output[dest + 3] = alpha;
    }
    [previous, current] = [current, previous];
  }
  return { width: h.width, height: h.height, data: output };
}

function pngChunk(type, data) {
  const chunk = new Uint8Array(data.length + 12);
  write32(chunk, 0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8); write32(chunk, chunk.length - 4, crc32(chunk, 4, chunk.length - 4));
  return chunk;
}
/** Encode a lossless, deterministic RGBA8 PNG with no ancillary metadata. */
export function encodePNG(image) {
  rgba(image);
  const header = new Uint8Array(13);
  write32(header, 0, image.width); write32(header, 4, image.height); header[8] = 8; header[9] = 6;
  const stride = image.width * 4, scan = new Uint8Array((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) scan.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return concat([SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', zlibSync(scan, { level: 6, mem: 6 })), pngChunk('IEND', new Uint8Array(0))]);
}

export function inspectImage(image) {
  rgba(image);
  let opaquePixels = 0, transparentPixels = 0, partialAlphaPixels = 0;
  let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const alpha = image.data[(y * image.width + x) * 4 + 3];
    if (alpha === 0) transparentPixels++;
    else {
      if (alpha === 255) opaquePixels++; else partialAlphaPixels++;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  return { width: image.width, height: image.height, opaquePixels, transparentPixels, partialAlphaPixels,
    hasTransparency: transparentPixels + partialAlphaPixels > 0,
    bounds: right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } };
}
function rect(value, image) {
  object(value, 'frame rectangle'); keys(value, ['x', 'y', 'width', 'height'], 'rectangle');
  const x = integer(value.x, 'rect.x', 0, image.width - 1), y = integer(value.y, 'rect.y', 0, image.height - 1);
  const width = integer(value.width, 'rect.width', 1, image.width), height = integer(value.height, 'rect.height', 1, image.height);
  if (x + width > image.width || y + height > image.height) fail('INVALID_OPTION', 'Frame rectangle extends outside the source image.');
  return { x, y, width, height };
}
function copyRect(image, region) {
  const output = { width: region.width, height: region.height, data: new Uint8Array(region.width * region.height * 4) };
  for (let y = 0; y < region.height; y++) {
    const pos = ((region.y + y) * image.width + region.x) * 4;
    output.data.set(image.data.subarray(pos, pos + region.width * 4), y * region.width * 4);
  }
  return output;
}
/** Explicit row-major extraction only. Grid division must be exact; no automatic character/pose detection. */
export function extractFrames(image, source = { kind: 'single' }) {
  rgba(image); object(source, 'source');
  let rectangles;
  if (source.kind === 'single') {
    keys(source, ['kind'], 'source');
    rectangles = [{ x: 0, y: 0, width: image.width, height: image.height }];
  }
  else if (source.kind === 'rects') {
    keys(source, ['kind', 'rects'], 'source');
    if (!Array.isArray(source.rects)) fail('INVALID_OPTION', 'source.rects must be an array.');
    integer(source.rects.length, 'rectangle count', 1, LIMITS.maxFrames);
    rectangles = source.rects.map((r) => rect(r, image));
  } else if (source.kind === 'grid') {
    keys(source, ['kind', 'columns', 'rows', 'count', 'margin', 'spacing'], 'source');
    const columns = integer(source.columns, 'columns', 1, LIMITS.maxFrames), rows = integer(source.rows, 'rows', 1, LIMITS.maxFrames);
    const count = integer(defaultIfUndefined(source.count, columns * rows), 'frame count', 1, Math.min(LIMITS.maxFrames, columns * rows));
    const margin = integer(defaultIfUndefined(source.margin, 0), 'margin', 0, LIMITS.maxDimension), spacing = integer(defaultIfUndefined(source.spacing, 0), 'spacing', 0, LIMITS.maxDimension);
    const usableW = image.width - 2 * margin - (columns - 1) * spacing, usableH = image.height - 2 * margin - (rows - 1) * spacing;
    if (usableW <= 0 || usableH <= 0 || usableW % columns || usableH % rows) fail('INVALID_OPTION', 'Grid must divide the source dimensions exactly after margin and spacing.');
    const width = usableW / columns, height = usableH / rows;
    rectangles = Array.from({ length: count }, (_, i) => ({ x: margin + (i % columns) * (width + spacing), y: margin + Math.floor(i / columns) * (height + spacing), width, height }));
  } else fail('INVALID_OPTION', 'source.kind must be single, grid, or rects.');
  if (rectangles.reduce((n, r) => n + r.width * r.height, 0) > LIMITS.maxOutputPixels) fail('PIXEL_LIMIT', 'Extracted frame pixels exceed the output pixel limit.');
  return rectangles.map((r) => copyRect(image, r));
}

/** Pixels whose alpha is <= threshold become transparent black. Not semantic background removal. */
export function cleanAlpha(image, threshold = 0) {
  rgba(image); integer(threshold, 'alphaThreshold', 0, 255);
  const data = new Uint8Array(image.data);
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] <= threshold) data.fill(0, i, i + 4);
  return { width: image.width, height: image.height, data };
}
function blit(source, target, x, y) {
  for (let row = 0; row < source.height; row++)
    target.data.set(source.data.subarray(row * source.width * 4, (row + 1) * source.width * 4), ((row + y) * target.width + x) * 4);
}

/** Trim alpha bounds (optional), then pad and align without resizing or clipping. */
export function normalizeFrames(frames, options = {}) {
  frameList(frames); object(options, 'normalize');
  keys(options, ['width', 'height', 'padding', 'align', 'trim'], 'normalize');
  const padding = integer(defaultIfUndefined(options.padding, 0), 'padding', 0, 512);
  const align = defaultIfUndefined(options.align, 'center');
  if (!['center', 'bottom'].includes(align)) fail('INVALID_OPTION', 'align must be center or bottom.');
  const trim = bool(defaultIfUndefined(options.trim, true), 'trim');
  const bounds = frames.map((f) => trim ? inspectImage(f).bounds : { x: 0, y: 0, width: f.width, height: f.height });
  const requiredW = Math.max(...bounds.map((b) => b?.width ?? 1)) + padding * 2;
  const requiredH = Math.max(...bounds.map((b) => b?.height ?? 1)) + padding * 2;
  const width = defaultIfUndefined(options.width, requiredW), height = defaultIfUndefined(options.height, requiredH);
  const pixels = checkedPixels(width, height);
  if (width < requiredW || height < requiredH) fail('INVALID_OPTION', 'Normalization canvas is too small for the visible pixels and padding.');
  if (pixels * frames.length > LIMITS.maxOutputPixels) fail('PIXEL_LIMIT', 'Normalized frame pixels exceed the output pixel limit.');
  return frames.map((frame, i) => {
    const output = { width, height, data: new Uint8Array(pixels * 4) }, b = bounds[i];
    if (!b) return output;
    const x = Math.floor((width - b.width) / 2), y = align === 'bottom' ? height - padding - b.height : Math.floor((height - b.height) / 2);
    blit(copyRect(frame, b), output, x, y);
    return output;
  });
}

/** Copy one pose at constant integer dx/dy per frame; auto-expand canvas to avoid clipping. */
export function translateFrames(image, options = {}) {
  rgba(image); object(options, 'motion');
  keys(options, ['frames', 'dx', 'dy'], 'motion');
  const count = integer(defaultIfUndefined(options.frames, 12), 'motion.frames', 1, LIMITS.maxFrames);
  const dx = integer(defaultIfUndefined(options.dx, 0), 'motion.dx', -256, 256), dy = integer(defaultIfUndefined(options.dy, 0), 'motion.dy', -256, 256);
  const endX = dx * (count - 1), endY = dy * (count - 1);
  const width = image.width + Math.abs(endX), height = image.height + Math.abs(endY);
  const pixels = checkedPixels(width, height);
  if (pixels * count > LIMITS.maxOutputPixels) fail('PIXEL_LIMIT', 'Motion frame pixels exceed the output pixel limit. Reduce frames, translation, or canvas size.');
  return Array.from({ length: count }, (_, i) => {
    const result = { width, height, data: new Uint8Array(pixels * 4) };
    blit(image, result, dx * i - Math.min(0, endX), dy * i - Math.min(0, endY));
    return result;
  });
}

/** Filesystem-independent ASCII slug for export entries; never interprets paths. */
export function safeName(value = 'sprite') {
  if (typeof value !== 'string') fail('INVALID_OPTION', 'name must be a string.');
  const name = value.slice(0, 200).normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return name || 'sprite';
}

/** Combined atlas canvas + frame pixels must fit the 1M-pixel output budget. */
export function buildAtlas(frames, options = {}) {
  const framePixels = frameList(frames); object(options, 'atlas');
  keys(options, ['columns', 'fps', 'name'], 'atlas');
  const columns = integer(defaultIfUndefined(options.columns, Math.ceil(Math.sqrt(frames.length))), 'atlasColumns', 1, frames.length);
  const rows = Math.ceil(frames.length / columns);
  const cellWidth = Math.max(...frames.map((f) => f.width)), cellHeight = Math.max(...frames.map((f) => f.height));
  const width = cellWidth * columns, height = cellHeight * rows, atlasPixels = checkedPixels(width, height);
  if (framePixels + atlasPixels > LIMITS.maxOutputPixels) fail('PIXEL_LIMIT', 'Combined frame and atlas pixels exceed 1,000,000. Reduce frame count, size, padding, or atlas columns.');
  const fps = defaultIfUndefined(options.fps, 12);
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps < 1 || fps > 60) fail('INVALID_OPTION', 'fps must be a number from 1 to 60.');
  const name = safeName(options.name), data = new Uint8Array(atlasPixels * 4);
  const image = { width, height, data };
  const entries = frames.map((frame, i) => {
    const x = (i % columns) * cellWidth, y = Math.floor(i / columns) * cellHeight;
    blit(frame, image, x, y);
    return { filename: `${name}-${String(i + 1).padStart(3, '0')}.png`, frame: { x, y, w: frame.width, h: frame.height }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frame.width, h: frame.height }, sourceSize: { w: frame.width, h: frame.height }, duration: Math.round(1000 / fps) };
  });
  const metadata = { frames: entries, meta: { app: 'Dot Motion Studio', version: '1.0', image: `${name}-atlas.png`, format: 'RGBA8888', size: { w: width, h: height },
    scale: '1', fps, frameCount: frames.length, frameSize: { w: cellWidth, h: cellHeight }, columns, rows, loop: true, animation: 'ordered-frames' } };
  return { png: encodePNG(image), metadata, width, height };
}

/** Create atlas PNG + JSON and a deterministic PNG sequence ZIP (frames + atlas.json). */
export function exportBundle(frames, options = {}, includeSequence = true) {
  const atlas = buildAtlas(frames, options), atlasJSON = JSON.stringify(atlas.metadata, null, 2);
  const entries = Object.create(null);
  const zipOptions = { level: 0, mtime: new Date(1980, 0, 1, 0, 0, 0) };
  if (includeSequence) for (let i = 0; i < frames.length; i++) entries[atlas.metadata.frames[i].filename] = [encodePNG(frames[i]), zipOptions];
  entries[`${safeName(options.name)}-atlas.json`] = [strToU8(atlasJSON), zipOptions];
  const sequenceZip = includeSequence ? zipSync(entries, zipOptions) : new Uint8Array(0);
  return { atlasPng: atlas.png, atlasJSON, sequenceZip, metadata: atlas.metadata,
    summary: { frameCount: frames.length, frameWidth: atlas.metadata.meta.frameSize.w, frameHeight: atlas.metadata.meta.frameSize.h, atlasWidth: atlas.width, atlasHeight: atlas.height, fps: atlas.metadata.meta.fps } };
}

/** Bounded, synchronous end-to-end transform. All input/options are untrusted and validated. */
export function runPipeline(pngBytes, options = {}, includeSequence = true) {
  object(options, 'options');
  keys(options, ['name', 'fps', 'source', 'alphaThreshold', 'normalize', 'motion', 'atlasColumns'], 'pipeline');
  const header = inspectPNG(pngBytes), image = decodePNG(pngBytes);
  const inspection = { ...header, ...inspectImage(image) };
  let frames = extractFrames(image, defaultIfUndefined(options.source, { kind: 'single' })).map((frame) => cleanAlpha(frame, defaultIfUndefined(options.alphaThreshold, 0)));
  if (options.normalize !== undefined) frames = normalizeFrames(frames, options.normalize);
  if (options.motion !== undefined) {
    if (frames.length !== 1) fail('INVALID_OPTION', 'Constant translation takes exactly one source frame. Use single input or select one explicit rectangle.');
    frames = translateFrames(frames[0], options.motion);
  }
  const bundle = exportBundle(frames, { columns: options.atlasColumns, fps: options.fps, name: options.name }, includeSequence);
  return { inspection, ...bundle };
}
