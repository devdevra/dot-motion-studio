import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { encodePNG, runPipeline, decodePNG, normalizeFrames, translateFrames, buildAtlas, safeName } from '../lib/motion-engine.mjs';

// Load the real service, protocol, and HTTP routes without a production server.
const root = new URL('../', import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'dot-motion-null-contract-'));
after(() => rm(temp, { recursive: true, force: true }));
async function compile(sourcePath, outputName, replacements) {
  let source = await readFile(new URL(sourcePath, root), 'utf8');
  for (const [from, to] of replacements) source = source.replace(from, to);
  await writeFile(join(temp, outputName), ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  return import(pathToFileURL(join(temp, outputName)).href);
}
const service = await compile('lib/motion-service.ts', 'service.mjs', [
  ["'./motion-engine.mjs'", JSON.stringify(new URL('lib/motion-engine.mjs', root).href)],
]);
const { handleMCP, tools } = await compile('lib/mcp-protocol.ts', 'mcp.mjs', [["'./motion-service'", "'./service.mjs'"]]);
const { POST: processHTTP } = await compile('app/api/process/route.ts', 'process.mjs', [["'../../../lib/motion-service'", "'./service.mjs'"]]);
const { POST: inspectHTTP } = await compile('app/api/inspect/route.ts', 'inspect.mjs', [["'../../../lib/motion-service'", "'./service.mjs'"]]);

const pixels = new Uint8Array(8 * 8 * 4);
for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) pixels.set([30, 100, 200, 255], (y * 8 + x) * 4);
pixels.set([70, 80, 90, 0], 0); // Invisible RGB must still be cleaned exactly as before.
pixels[(3 * 8 + 3) * 4 + 3] = 128;
pixels[(4 * 8 + 4) * 4 + 3] = 1;
const png = encodePNG({ width: 8, height: 8, data: pixels });
const pngBase64 = Buffer.from(png).toString('base64');
const headers = { 'content-type': 'application/json', 'oai-authenticated-user-id': 'null-contract-test-user' };
const httpRequest = (body) => new Request('https://studio.example/api/process', { method: 'POST', headers, body: JSON.stringify(body) });
const rpcRequest = (name, args) => new Request('https://studio.example/mcp', {
  method: 'POST', headers,
  body: JSON.stringify({ jsonrpc: '2.0', id: 71, method: 'tools/call', params: { name, ...(args === undefined ? {} : { arguments: args }) } }),
});
async function rpc(name, args) {
  const response = await handleMCP(rpcRequest(name, args));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 71);
  return body;
}
function checkToolError(body, message) {
  assert.deepEqual(body, { jsonrpc: '2.0', id: 71, result: { isError: true, content: [{ type: 'text', text: message }] } });
}

// These cases cover each property declared in the externally advertised options schema,
// plus its object, array, item, and oneOf variant nodes. Each context is valid before mutation.
const optionCases = [
  ['options', null],
  ...['name', 'fps', 'alphaThreshold', 'atlasColumns', 'source', 'normalize', 'motion'].map((key) => [`options.${key}`, { [key]: null }]),
  ['options.source.single.kind', { source: { kind: null } }],
  ...['kind', 'columns', 'rows', 'count', 'margin', 'spacing'].map((key) => [`options.source.grid.${key}`, { source: { kind: 'grid', columns: 1, rows: 1, [key]: null } }]),
  ['options.source.rects.kind', { source: { kind: null, rects: [{ x: 0, y: 0, width: 8, height: 8 }] } }],
  ['options.source.rects.rects', { source: { kind: 'rects', rects: null } }],
  ['options.source.rects.rects[]', { source: { kind: 'rects', rects: [null] } }],
  ...['x', 'y', 'width', 'height'].map((key) => [`options.source.rects.rects[].${key}`, { source: { kind: 'rects', rects: [{ x: 0, y: 0, width: 8, height: 8, [key]: null }] } }]),
  ...['width', 'height', 'padding', 'align', 'trim'].map((key) => [`options.normalize.${key}`, { normalize: { [key]: null } }]),
  ...['frames', 'dx', 'dy'].map((key) => [`options.motion.${key}`, { motion: { frames: 2, dx: 0, dy: 0, [key]: null } }]),
];
function schemaPaths(schema, prefix) {
  const paths = [prefix];
  for (const branch of schema.oneOf ?? []) {
    const variant = branch.properties.kind.const;
    for (const [key, child] of Object.entries(branch.properties)) paths.push(...schemaPaths(child, `${prefix}.${variant}.${key}`));
  }
  for (const [key, child] of Object.entries(schema.properties ?? {})) paths.push(...schemaPaths(child, `${prefix}.${key}`));
  if (schema.items) paths.push(...schemaPaths(schema.items, `${prefix}[]`));
  return paths;
}
test('null matrix covers every advertised options property and nested container', () => {
  const schema = tools.find((tool) => tool.name === 'build_sprite').inputSchema.properties.options;
  assert.deepEqual(optionCases.map(([path]) => path).sort(), schemaPaths(schema, 'options').sort());
  assert.equal(optionCases.length, 30);
  for (const name of ['inspect_png', 'build_sprite']) {
    assert.equal(tools.find((tool) => tool.name === name).inputSchema.properties.pngBase64.type, 'string');
  }
  assert.equal(tools.find((tool) => tool.name === 'build_sprite').inputSchema.properties.includeSequenceZip.type, 'boolean');
});
for (const [path, options] of optionCases) {
  test(`${path}: null rejects consistently in engine, HTTP, and MCP`, async () => {
    let engineMessage;
    assert.throws(() => runPipeline(png, options), (error) => {
      assert.equal(error.name, 'MotionError');
      assert.equal(error.code, 'INVALID_OPTION');
      engineMessage = error.message;
      return true;
    });
    const expectedMessage = options === null ? 'Options must be an object.' : engineMessage;
    const response = await processHTTP(httpRequest({ pngBase64, options }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: expectedMessage });
    checkToolError(await rpc('build_sprite', { pngBase64, options }), expectedMessage);
  });
}
for (const name of ['motion_capabilities', 'inspect_png', 'build_sprite']) {
  test(`${name}: null and nonobject MCP arguments keep JSON-RPC invalid-params shape`, async () => {
    for (const args of [null, [], 0, false, 'invalid']) {
      assert.deepEqual(await rpc(name, args), {
        jsonrpc: '2.0', id: 71, error: { code: -32602, message: 'Arguments must be an object.' },
      });
    }
  });
}
for (const [name, handler] of [['inspect_png', inspectHTTP], ['build_sprite', processHTTP]]) {
  test(`${name}: null PNG is rejected with stable HTTP and MCP shapes`, async () => {
    let message;
    assert.throws(() => service.fromBase64(null), (error) => { message = error.message; return true; });
    const response = await handler(httpRequest({ pngBase64: null }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: message });
    checkToolError(await rpc(name, { pngBase64: null }), message);
  });
  test(`${name}: HTTP body containers reject null and primitive/array inputs`, async () => {
    for (const input of [null, [], 0, false, 'invalid']) {
      const response = await handler(httpRequest(input));
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { error: 'Input must be an object.' });
    }
  });
}
test('MCP ZIP boolean rejects null and other nonbooleans before processing', async () => {
  for (const includeSequenceZip of [null, [], {}, 0, 1, 'false', 'true']) {
    assert.deepEqual(await rpc('build_sprite', { pngBase64, includeSequenceZip }), {
      jsonrpc: '2.0', id: 71, error: { code: -32602, message: 'includeSequenceZip must be a boolean.' },
    });
  }
});
test('omitted MCP arguments still permit capabilities and reject missing PNGs', async () => {
  for (const args of [undefined, {}]) {
    const capabilities = await rpc('motion_capabilities', args);
    assert.equal(capabilities.result.content[0].type, 'text');
    assert.equal(JSON.parse(capabilities.result.content[0].text).version, '1.0.0');
    for (const name of ['inspect_png', 'build_sprite']) {
      const result = await rpc(name, args);
      assert.equal(result.result.isError, true);
      assert.match(result.result.content[0].text, /Provide a PNG as standard base64/);
    }
  }
});
test('null object/array members cannot bypass validation via another container type', () => {
  for (const options of [[], { source: [] }, { normalize: [] }, { motion: [] },
    { source: { kind: 'rects', rects: {} } }, { source: { kind: 'rects', rects: [[]] } }]) {
    assert.throws(() => runPipeline(png, options), { name: 'MotionError', code: 'INVALID_OPTION' });
  }
});
test('direct primitive helpers reject null where their option contracts disallow it', () => {
  const image = decodePNG(png);
  for (const operation of [
    () => normalizeFrames(null), () => normalizeFrames([null]), () => normalizeFrames([image], null),
    () => translateFrames(image, null), () => buildAtlas(null), () => buildAtlas([null]),
    () => buildAtlas([image], null), () => safeName(null),
    ...['columns', 'fps', 'name'].map((key) => () => buildAtlas([image], { [key]: null })),
  ]) assert.throws(operation, { name: 'MotionError', code: 'INVALID_OPTION' });
});

const validCases = [
  ['default', {}],
  ['explicit defaults', { name: 'sprite', fps: 12, alphaThreshold: 0, atlasColumns: 1, source: { kind: 'single' } }],
  ['grid defaults', { source: { kind: 'grid', columns: 2, rows: 2 } }],
  ['grid explicit', { source: { kind: 'grid', columns: 2, rows: 2, count: 3, margin: 0, spacing: 0 }, fps: 24, atlasColumns: 3 }],
  ['rectangles', { source: { kind: 'rects', rects: [{ x: 0, y: 0, width: 4, height: 4 }, { x: 4, y: 4, width: 4, height: 4 }] }, name: 'rects', fps: 24, atlasColumns: 2 }],
  ['normalize defaults', { normalize: {} }],
  ['normalize explicit', { normalize: { width: 10, height: 12, padding: 1, align: 'bottom', trim: false } }],
  ['motion defaults', { motion: {} }],
  ['motion explicit', { motion: { frames: 3, dx: -2, dy: 1 }, fps: 60, name: 'move', atlasColumns: 3 }],
  ['alpha threshold', { alphaThreshold: 128 }],
  ['safe name', { name: '../sprite test 한글' }],
  ['combined', { source: { kind: 'rects', rects: [{ x: 0, y: 0, width: 8, height: 8 }] }, alphaThreshold: 1, normalize: { width: 6, height: 6, padding: 1, align: 'center', trim: true }, motion: { frames: 3, dx: 0, dy: -1 }, fps: 30, name: 'combo', atlasColumns: 3 }],
];
const golden = JSON.parse(await readFile(new URL('fixtures/null-contract-golden.json', import.meta.url), 'utf8'));
function digests(result) {
  const sha = (value) => createHash('sha256').update(value).digest('hex');
  return {
    atlas: sha(result.atlasPng), zip: sha(result.sequenceZip), json: sha(result.atlasJSON),
    details: sha(JSON.stringify({ inspection: result.inspection, summary: result.summary, metadata: result.metadata })),
  };
}
for (const [name, options] of validCases) {
  test(`${name}: valid pipeline preserves baseline PNG, ZIP, JSON, and metadata bytes`, () => {
    assert.deepEqual(digests(runPipeline(png, options)), golden[name]);
  });
}
test('omitted and explicit undefined fields preserve their defaults', () => {
  const pairs = [
    [undefined, { name: undefined, fps: undefined, alphaThreshold: undefined, atlasColumns: undefined, source: undefined, normalize: undefined, motion: undefined }],
    [{ source: { kind: 'grid', columns: 2, rows: 2 } }, { source: { kind: 'grid', columns: 2, rows: 2, count: undefined, margin: undefined, spacing: undefined } }],
    [{ normalize: {} }, { normalize: { width: undefined, height: undefined, padding: undefined, align: undefined, trim: undefined } }],
    [{ motion: {} }, { motion: { frames: undefined, dx: undefined, dy: undefined } }],
  ];
  for (const [omitted, explicitUndefined] of pairs) assert.deepEqual(runPipeline(png, omitted), runPipeline(png, explicitUndefined));
});
test('zero and false retain their meaning, and blank-image output bounds may remain null', () => {
  assert.equal(runPipeline(png, { normalize: { trim: false } }).summary.frameWidth, 8);
  assert.equal(runPipeline(png, { normalize: { trim: true } }).summary.frameWidth, 4);
  const blank = runPipeline(png, { alphaThreshold: 255, normalize: {} });
  assert.equal(blank.summary.frameWidth, 1);
  assert.equal(blank.summary.frameHeight, 1);
  assert.deepEqual([...decodePNG(blank.atlasPng).data], [0, 0, 0, 0]);
  assert.equal(service.inspectInput({ pngBase64: Buffer.from(encodePNG({ width: 1, height: 1, data: new Uint8Array(4) })).toString('base64') }).bounds, null);
});
test('HTTP and MCP retain valid atlas bytes; omitted/false ZIP differ only in ZIP content', async () => {
  const expected = service.processInput({ pngBase64 });
  const response = await processHTTP(httpRequest({ pngBase64 }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), expected);
  const inspection = await inspectHTTP(httpRequest({ pngBase64 }));
  assert.equal(inspection.status, 200);
  assert.deepEqual(await inspection.json(), expected.inspection);
  for (const includeSequenceZip of [undefined, false, true]) {
    const body = await rpc('build_sprite', { pngBase64, ...(includeSequenceZip === undefined ? {} : { includeSequenceZip }) });
    assert.equal(body.error, undefined);
    assert.equal(body.result.isError, undefined);
    assert.equal(body.result.content.length, includeSequenceZip === true ? 3 : 2);
    assert.deepEqual(JSON.parse(body.result.content[0].text), { summary: expected.summary, metadata: expected.metadata, inspection: expected.inspection });
    assert.deepEqual(body.result.content[1], { type: 'image', mimeType: 'image/png', data: expected.atlasBase64 });
    if (includeSequenceZip === true) assert.equal(body.result.content[2].resource.blob, expected.sequenceZipBase64);
  }
  const inspected = await rpc('inspect_png', { pngBase64 });
  assert.deepEqual(JSON.parse(inspected.result.content[0].text), expected.inspection);
});
