/** Local-only compiled Worker checks. Never point this runner at a deployed Site. */
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { encodePNG, decodePNG, runPipeline } from '../lib/motion-engine.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(project, 'dist/server');
const files = await readdir(root, { recursive: true });
const modules = ['index.js', ...files.filter(f => f.endsWith('.js') && f !== 'index.js')]
  .map(f => ({ type: 'ESModule', path: path.join(root, f) }));
const runtime = new Miniflare({ modules, modulesRoot: root, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'], cf: false });
const results = [];
const b64 = bytes => Buffer.from(bytes).toString('base64');
const input = encodePNG({ width: 8, height: 8, data: Uint8Array.from({ length: 256 }, (_, i) => (i * 31) & 255) });
const pngBase64 = b64(input);

function crc(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; }
function chunk(name, data) { const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length, 0); out.write(name, 4); Buffer.from(data).copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, -4)), out.length - 4); return out; }
function fixture(zlibHex) { const ihdr = Buffer.from('00000001000000010800000000', 'hex'); return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', Buffer.from(zlibHex, 'hex')), chunk('IEND', Buffer.alloc(0))]); }
const invalid = [
  ['invalid Adler position', fixture('789c636000000000020001')],
  ['invalid stored NLEN', fixture('7801010200fcff000000020001')],
  ['truncated Adler', fixture('789c63600000000200')],
];
const suffix = fixture('789c636000000002000100');
const ordinary = fixture('789c6360000000020001');

async function request(route, body, auth = true, extraHeaders = {}) {
  return runtime.dispatchFetch('http://local-motion-qa.invalid' + route, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { 'oai-authenticated-user-id': 'local-only-synthetic-qa-identity' } : {}), ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function rpc(name, args) { return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }; }
async function check(name, fn) { const start = performance.now(); await fn(); results.push({ name, pass: true, durationMs: Math.round(performance.now() - start) }); console.log('PASS', name); }
function noStore(r) { assert.equal(r.headers.get('cache-control'), 'no-store'); }
try {
  for (const route of ['/api/inspect', '/api/process']) await check(`${route} rejects signed-out calls`, async () => { const r = await request(route, { pngBase64 }, false); assert.equal(r.status, 401); noStore(r); assert.match((await r.json()).error, /Sign in/); });
  await check('MCP data call rejects signed-out identity', async () => { const r = await request('/mcp', rpc('inspect_png', { pngBase64 }), false); noStore(r); assert.equal(r.status, 401); assert.equal((await r.json()).error.code, -32001); });
  await check('MCP capabilities remains public', async () => { const r = await request('/mcp', rpc('motion_capabilities', {}), false); noStore(r); assert.equal(r.status, 200); assert.ok((await r.json()).result.content); });
  await check('Local authenticated processing equals direct engine bytes', async () => { const options = { motion: { frames: 3, dx: -2, dy: 1 }, fps: 12, name: 'worker-qa' }; const direct = runPipeline(input, options, true); const r = await request('/api/process', { pngBase64, options }); assert.equal(r.status, 200); noStore(r); const out = await r.json(); assert.equal(out.atlasBase64, b64(direct.atlasPng)); assert.equal(out.sequenceZipBase64, b64(direct.sequenceZip)); assert.equal(out.atlasJSON, direct.atlasJSON); assert.deepEqual(out.metadata, direct.metadata); });
  for (const [name, bytes] of invalid) {
    for (const route of ['/api/inspect', '/api/process']) await check(`${route}: ${name}`, async () => { const r = await request(route, { pngBase64: b64(bytes) }); assert.equal(r.status, 400); noStore(r); const out = await r.json(); assert.equal(typeof out.error, 'string'); assert.ok(out.error.length > 0); assert.equal(out.atlasBase64, undefined); });
    await check(`MCP: ${name}`, async () => { const r = await request('/mcp', rpc('build_sprite', { pngBase64: b64(bytes) })); noStore(r); assert.equal(r.status, 200); const out = await r.json(); assert.equal(out.result.isError, true); assert.equal(out.result.content.length, 1); assert.equal(out.result.content[0].type, 'text'); });
  }
  await check('Legal zlib suffix preserves complete output bytes', async () => { const a = await request('/api/process', { pngBase64: b64(ordinary) }); const b = await request('/api/process', { pngBase64: b64(suffix) }); assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(await a.text(), await b.text()); assert.deepEqual(decodePNG(suffix).data, Uint8Array.of(0, 0, 0, 255)); });
  await check('Explicit null API options do not default', async () => { const r = await request('/api/process', { pngBase64, options: { normalize: { trim: null } } }); assert.equal(r.status, 400); assert.match((await r.json()).error, /boolean/); });
  await check('Explicit null MCP arguments do not default', async () => { const r = await request('/mcp', rpc('motion_capabilities', null)); noStore(r); assert.equal(r.status, 200); assert.equal((await r.json()).error.code, -32602); });
  await check('Invalid ZIP type keeps JSON-RPC error contract', async () => { const r = await request('/mcp', rpc('build_sprite', { pngBase64, includeSequenceZip: null })); noStore(r); assert.equal(r.status, 200); assert.equal((await r.json()).error.code, -32602); });
  for (const route of ['/api/inspect', '/api/process']) await check(`${route} rejects a null JSON body deliberately`, async () => { const r = await request(route, null); assert.equal(r.status, 400); noStore(r); assert.deepEqual(await r.json(), { error: 'Input must be an object.' }); });
  await check('Null nested MCP option preserves tool-error envelope', async () => { const r = await request('/mcp', rpc('build_sprite', { pngBase64, options: { normalize: { trim: null } } })); noStore(r); assert.equal(r.status, 200); const out = await r.json(); assert.equal(out.jsonrpc, '2.0'); assert.equal(out.id, 1); assert.equal(out.error, undefined); assert.equal(out.result.isError, true); assert.equal(out.result.content.length, 1); assert.equal(out.result.content[0].type, 'text'); assert.match(out.result.content[0].text, /boolean/); });
  await check('Non-JSON body rejected before processing', async () => { const r = await request('/api/process', '{}', true, { 'content-type': 'text/plain' }); assert.equal(r.status, 415); noStore(r); });
  await check('Oversized streamed JSON rejected and worker recovers', async () => { let count = 0; const body = new ReadableStream({ pull(controller) { if (++count > 31) controller.close(); else controller.enqueue(new Uint8Array(100_000).fill(32)); } }); const r = await runtime.dispatchFetch('http://local-motion-qa.invalid/api/process', { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': 'local-only-synthetic-qa-identity' }, body, duplex: 'half' }); assert.equal(r.status, 413); noStore(r); const next = await request('/api/inspect', { pngBase64 }); assert.equal(next.status, 200); });
  await check('Sequential maximum-pixel inspections remain deterministic', async () => { const max = encodePNG({ width: 1000, height: 1000, data: new Uint8Array(4_000_000).fill(127) }); let expected; for (let i = 0; i < 4; i++) { const r = await request('/api/inspect', { pngBase64: b64(max) }); assert.equal(r.status, 200); const text = await r.text(); if (expected === undefined) expected = text; else assert.equal(text, expected); } });
  console.log(JSON.stringify({ scope: 'Local compiled Worker in Miniflare/workerd, synthetic identity only; does not verify deployed authentication or production memory ceiling.', passed: results.length, results }, null, 2));
} finally { await runtime.dispose(); }
