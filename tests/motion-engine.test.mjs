import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync, deflateSync } from 'node:zlib';
import { unzipSync, strFromU8 } from 'fflate';
import {
  LIMITS, MotionError, inspectPNG, decodePNG, encodePNG, inspectImage, extractFrames,
  cleanAlpha, normalizeFrames, translateFrames, safeName, buildAtlas, exportBundle, runPipeline,
} from '../lib/motion-engine.mjs';

function image(width, height, pixel = [0, 0, 0, 0]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(typeof pixel === 'function' ? pixel(i % width, Math.floor(i / width)) : pixel, i * 4);
  return { width, height, data };
}
function at(img, x, y) { return [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x + 1) * 4)]; }
function errorCode(fn, code) { assert.throws(fn, (e) => e instanceof MotionError && e.code === code); }
function crc(bytes) { // Independent bitwise fixture CRC.
  let c = 0xffffffff;
  for (const v of bytes) { c ^= v; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes = []) {
  const data = Buffer.from(bytes), name = Buffer.from(type), output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0); name.copy(output, 4); data.copy(output, 8);
  output.writeUInt32BE(crc(Buffer.concat([name, data])), 8 + data.length);
  return output;
}
function fixture({ width = 1, height = 1, depth = 8, type = 6, interlace = 0, scan = [0, 255, 0, 0, 255], before = [], compressed, after = [] } = {}) {
  const h = Buffer.alloc(13); h.writeUInt32BE(width, 0); h.writeUInt32BE(height, 4); h[8] = depth; h[9] = type; h[12] = interlace;
  return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',h), ...before, chunk('IDAT', compressed ?? deflateSync(Buffer.from(scan))), ...after, chunk('IEND')]));
}
function extractChunks(bytes) {
  const chunks = [];
  for (let off = 8; off < bytes.length;) {
    const len = new DataView(bytes.buffer, bytes.byteOffset + off).getUint32(0);
    chunks.push({ type: String.fromCharCode(...bytes.subarray(off + 4, off + 8)), data: bytes.subarray(off + 8, off + 8 + len) }); off += 12 + len;
  }
  return chunks;
}

test('RGBA8 round-trip and independent Node inflate agree', () => {
  const source = image(11, 7, (x,y) => [x * 23, y * 31, (x + y) * 11, (x * 17 + y * 5) % 256]);
  const png = encodePNG(source), decoded = decodePNG(png);
  assert.deepEqual(decoded, source);
  const chunks = extractChunks(png);
  const raw = inflateSync(Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => Buffer.from(c.data))));
  assert.equal(raw.length, (source.width * 4 + 1) * source.height);
  for (let y=0; y<source.height; y++) { assert.equal(raw[y * 45], 0); assert.deepEqual([...raw.subarray(y * 45 + 1, (y+1)*45)], [...source.data.subarray(y*44,(y+1)*44)]); }
  assert.deepEqual(encodePNG(source), png);
});

test('known RGB, grayscale, grayscale-alpha, packed palette, and 16-bit fixtures', () => {
  assert.deepEqual(at(decodePNG(fixture({type:2,scan:[0,10,20,30]})),0,0),[10,20,30,255]);
  assert.deepEqual(at(decodePNG(fixture({type:0,depth:2,width:4,scan:[0,0b00011011]})),2,0),[170,170,170,255]);
  assert.deepEqual(at(decodePNG(fixture({type:4,scan:[0,37,128]})),0,0),[37,37,37,128]);
  const palette = fixture({type:3,depth:1,width:2,scan:[0,0b01000000], before:[chunk('PLTE',[255,0,0,0,255,0]), chunk('tRNS',[0,128])]});
  assert.deepEqual([...decodePNG(palette).data],[255,0,0,0,0,255,0,128]);
  assert.deepEqual(at(decodePNG(fixture({type:6,depth:16,scan:[0,1,255,127,254,255,255,128,0]})),0,0),[1,127,255,128]);
  const rgbTransparent = fixture({type:2,scan:[0,10,20,30],before:[chunk('tRNS',[0,10,0,20,0,30])]});
  assert.equal(at(decodePNG(rgbTransparent),0,0)[3],0);
  const grayTransparent = fixture({type:0,depth:1,width:2,scan:[0,0x40],before:[chunk('tRNS',[0,1])]});
  assert.deepEqual([...decodePNG(grayTransparent).data],[0,0,0,255,255,255,255,0]);
});

test('all PNG filters 0–4 decode independently constructed scanlines', () => {
  const rows = [[5,9,11,255,20,31,40,200], [17,30,90,180,91,73,51,128]];
  const paeth = (a,b,c) => { const p=a+b-c, pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c; };
  for(let filter=0;filter<=4;filter++) {
    const scan=[];
    for(let y=0;y<2;y++) { scan.push(filter); for(let x=0;x<8;x++) {const a=x>=4?rows[y][x-4]:0,b=y?rows[y-1][x]:0,c=y&&x>=4?rows[y-1][x-4]:0;const p=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];scan.push((rows[y][x]-p+256)%256);} }
    assert.deepEqual([...decodePNG(fixture({width:2,height:2,scan})).data],rows.flat());
  }
});

test('PNG preflight rejects size bombs before inflate and unsupported inputs', () => {
  errorCode(()=>decodePNG(fixture({width:1001,height:1000,compressed:[0,0,0,0,0,0]})),'PIXEL_LIMIT');
  errorCode(()=>inspectPNG(new Uint8Array(LIMITS.maxInputBytes+1)),'INPUT_LIMIT');
  errorCode(()=>decodePNG(fixture({interlace:1})),'UNSUPPORTED_PNG');
  errorCode(()=>decodePNG(fixture({depth:4,type:6})),'UNSUPPORTED_PNG');
  errorCode(()=>decodePNG(fixture({before:[chunk('acTL',new Uint8Array(8))]})),'UNSUPPORTED_PNG');
  errorCode(()=>decodePNG(fixture({before:[chunk('ABCD')]})),'UNSUPPORTED_PNG');
  errorCode(()=>decodePNG('https://example.com/sprite.png'),'INVALID_PNG');
});

test('PNG rejects malformed CRC, lengths, order, filters, checksums, palettes, and truncated streams', () => {
  const badCrc = fixture(); badCrc[29]^=1; errorCode(()=>decodePNG(badCrc),'INVALID_PNG');
  errorCode(()=>decodePNG(fixture().subarray(0,50)),'INVALID_PNG');
  errorCode(()=>decodePNG(fixture({scan:[5,0,0,0,0]})),'INVALID_PNG');
  errorCode(()=>decodePNG(fixture({scan:[0,1,2,3]})),'INVALID_PNG');
  const z = new Uint8Array(deflateSync(Buffer.from([0,255,0,0,255]))); z[z.length-1]^=1;
  errorCode(()=>decodePNG(fixture({compressed:z})),'INVALID_PNG');
  errorCode(()=>decodePNG(fixture({compressed:[120,156,255,255,255,255]})),'INVALID_PNG');
  errorCode(()=>decodePNG(fixture({type:3,depth:1,scan:[0,0x80],before:[chunk('PLTE',[255,0,0])]})),'INVALID_PNG');
  errorCode(()=>decodePNG(fixture({after:[chunk('tEXt',[65]),chunk('IDAT',[0])]})),'INVALID_PNG');
  errorCode(()=>decodePNG(fixture({before:[chunk('tRNS',[0,0])]})),'INVALID_PNG');
  const trailing = new Uint8Array(fixture().length+1); trailing.set(fixture()); errorCode(()=>decodePNG(trailing),'INVALID_PNG');
});

test('bounded inflate rejects a compressed expansion bomb', () => {
  const bomb = fixture({compressed:deflateSync(Buffer.alloc(8_000_000))});
  assert.ok(bomb.length < 10_000);
  errorCode(()=>decodePNG(bomb),'INVALID_PNG');
});

test('streaming inflate handles large valid data and IDAT splits', () => {
  let seed=1984;
  const source=image(128,128,()=>{const a=[];for(let i=0;i<4;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;a.push(seed>>>24);}return a;});
  const png=encodePNG(source), chunks=extractChunks(png), idat=chunks.find(c=>c.type==='IDAT').data;
  assert.ok(idat.length > 1024);
  const parts=[];for(let i=0;i<idat.length;i+=773)parts.push(chunk('IDAT',idat.subarray(i,i+773)));
  const split=new Uint8Array(Buffer.concat([Buffer.from(png.subarray(0,8)),chunk('IHDR',chunks[0].data),...parts,chunk('IEND')]));
  assert.deepEqual(decodePNG(split),source);
});

test('alpha inspection and threshold cleanup are precise and immutable', () => {
  const source=image(3,1,(x)=>[[10,20,30,0],[1,2,3,120],[8,9,10,255]][x]);
  const info=inspectImage(source);
  assert.deepEqual(info.bounds,{x:1,y:0,width:2,height:1});
  assert.equal(info.transparentPixels,1);assert.equal(info.partialAlphaPixels,1);assert.equal(info.opaquePixels,1);
  const cleaned=cleanAlpha(source,120);
  assert.deepEqual([...cleaned.data],[0,0,0,0,0,0,0,0,8,9,10,255]);
  assert.deepEqual(at(source,0,0),[10,20,30,0]);
  assert.equal(inspectImage(image(2,2)).bounds,null);
});

test('explicit grid, margin/spacing, count, and rectangle extraction', () => {
  const source=image(7,5,(x,y)=>[x,y,0,255]);
  const frames=extractFrames(source,{kind:'grid',columns:2,rows:1,margin:1,spacing:1});
  assert.equal(frames.length,2);assert.deepEqual([frames[0].width,frames[0].height],[2,3]);
  assert.deepEqual(at(frames[1],0,0),[4,1,0,255]);
  assert.equal(extractFrames(source,{kind:'grid',columns:2,rows:1,margin:1,spacing:1,count:1}).length,1);
  assert.deepEqual(at(extractFrames(source,{kind:'rects',rects:[{x:5,y:3,width:2,height:2}]})[0],1,1),[6,4,0,255]);
  errorCode(()=>extractFrames(source,{kind:'grid',columns:2,rows:2}),'INVALID_OPTION');
  errorCode(()=>extractFrames(source,{kind:'rects',rects:[{x:6,y:4,width:2,height:2}]}),'INVALID_OPTION');
  errorCode(()=>extractFrames(source,{kind:'rects',rects:Array(65).fill({x:0,y:0,width:1,height:1})}),'INVALID_OPTION');
  errorCode(()=>extractFrames(source,{kind:'automatic'}),'INVALID_OPTION');
});

test('normalization trims alpha bounds and aligns center/bottom without clipping', () => {
  const red=[255,0,0,255];
  const source=image(5,5,(x,y)=>x===4&&y===0?red:[0,0,0,0]);
  const centered=normalizeFrames([source],{width:5,height:5,padding:1,align:'center'})[0];
  assert.deepEqual(inspectImage(centered).bounds,{x:2,y:2,width:1,height:1});
  const bottom=normalizeFrames([source],{width:5,height:5,padding:1,align:'bottom'})[0];
  assert.deepEqual(inspectImage(bottom).bounds,{x:2,y:3,width:1,height:1});
  assert.deepEqual([normalizeFrames([source],{padding:1})[0].width,normalizeFrames([source],{padding:1})[0].height],[3,3]);
  assert.deepEqual([normalizeFrames([image(4,4)])[0].width,normalizeFrames([image(4,4)])[0].height],[1,1]);
  assert.deepEqual(normalizeFrames([source],{trim:false})[0],source);
  errorCode(()=>normalizeFrames([source],{width:2,height:2,padding:1}),'INVALID_OPTION');
});

test('constant translation preserves pixels, handles negative directions, and never clips', () => {
  const source=image(2,2,[1,2,3,123]), positive=translateFrames(source,{frames:3,dx:2,dy:1});
  assert.equal(positive.length,3);assert.equal(positive[0].width,6);assert.equal(positive[0].height,4);
  assert.deepEqual(inspectImage(positive[2]).bounds,{x:4,y:2,width:2,height:2});
  assert.deepEqual(at(positive[2],5,3),[1,2,3,123]);
  const negative=translateFrames(source,{frames:3,dx:-2,dy:-1});
  assert.deepEqual(inspectImage(negative[0]).bounds,{x:4,y:2,width:2,height:2});
  assert.deepEqual(inspectImage(negative[2]).bounds,{x:0,y:0,width:2,height:2});
  assert.deepEqual(translateFrames(source,{frames:1,dx:256,dy:-256})[0],source);
  errorCode(()=>translateFrames(source,{frames:65}),'INVALID_OPTION');
  errorCode(()=>translateFrames(source,{dx:0.5}),'INVALID_OPTION');
  errorCode(()=>translateFrames(source,{frames:64,dx:256}),'INVALID_OPTION');
});

test('atlas coordinates, transparent unused cells, and aggregate pixel budgets', () => {
  const frames=[image(2,2,[255,0,0,255]),image(1,1,[0,255,0,255]),image(2,1,[0,0,255,255])];
  const atlas=buildAtlas(frames,{columns:2,name:'walk',fps:10}), decoded=decodePNG(atlas.png);
  assert.deepEqual([atlas.width,atlas.height],[4,4]);
  assert.deepEqual(atlas.metadata.frames.map(f=>f.frame),[{x:0,y:0,w:2,h:2},{x:2,y:0,w:1,h:1},{x:0,y:2,w:2,h:1}]);
  assert.deepEqual(at(decoded,2,0),[0,255,0,255]);assert.deepEqual(at(decoded,3,3),[0,0,0,0]);
  assert.equal(atlas.metadata.frames[0].duration,100);
  const large=image(1000,1000,[1,2,3,255]);
  errorCode(()=>buildAtlas([large,large,large]),'PIXEL_LIMIT');
  errorCode(()=>buildAtlas([image(2,2)],{fps:Infinity}),'INVALID_OPTION');
});

test('ZIP entries are safe and deterministic; JSON matches returned metadata', () => {
  const frames=[image(2,2,[1,2,3,255]),image(2,2,[9,8,7,0])];
  const options={name:'../../evil\\name.png',fps:12};
  const output=exportBundle(frames,options), again=exportBundle(frames,options);
  assert.deepEqual(output.sequenceZip,again.sequenceZip);assert.deepEqual(output.atlasPng,again.atlasPng);
  const entries=unzipSync(output.sequenceZip), names=Object.keys(entries);
  assert.deepEqual(names,['evil-name-png-001.png','evil-name-png-002.png','evil-name-png-atlas.json']);
  assert.deepEqual(JSON.parse(strFromU8(entries[names[2]])),output.metadata);
  assert.deepEqual(JSON.parse(output.atlasJSON),output.metadata);
  assert.deepEqual(decodePNG(entries[names[0]]),frames[0]);
  assert.equal(safeName('/../'),'sprite'); assert.equal(safeName('a'.repeat(500)).length,48);
});

test('end-to-end grid and single-image motion pipeline exports inspectable artifacts', () => {
  const source=image(4,2,(x)=>x<2?[255,0,0,255]:[0,255,0,255]);
  const grid=runPipeline(encodePNG(source),{name:'tiles',source:{kind:'grid',columns:2,rows:1},fps:8,atlasColumns:2});
  assert.equal(grid.summary.frameCount,2); assert.equal(grid.inspection.opaquePixels,8);
  assert.deepEqual(at(decodePNG(grid.atlasPng),2,0),[0,255,0,255]);
  const moved=runPipeline(encodePNG(image(1,1,[0,0,255,255])),{motion:{frames:4,dx:1,dy:0},name:'slide'});
  assert.deepEqual(moved.summary,{frameCount:4,frameWidth:4,frameHeight:1,atlasWidth:8,atlasHeight:2,fps:12});
  errorCode(()=>runPipeline(encodePNG(source),{source:{kind:'grid',columns:2,rows:1},motion:{frames:3}}),'INVALID_OPTION');
});

test('untrusted options reject unknown fields and invalid types', () => {
  const input=encodePNG(image(1,1));
  for(const opts of [{bogus:true},{source:{kind:'single',url:'https://example.com'}},{normalize:{trim:'false'}},{motion:{frameCount:2}},{source:{kind:'grid',columns:1,rows:1,spacing:NaN}}, {fps:0}, {alphaThreshold:256}, {name:{}}, {normalize:null}])
    errorCode(()=>runPipeline(input,opts),'INVALID_OPTION');
  errorCode(()=>buildAtlas([image(1,1)],{oops:1}),'INVALID_OPTION');
  errorCode(()=>encodePNG({width:1,height:1,data:new Uint8Array(3)}),'INVALID_IMAGE');
  errorCode(()=>runPipeline(input,[]),'INVALID_OPTION');
});
