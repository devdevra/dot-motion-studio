#!/usr/bin/env node
/** Actual unchanged production engine. No network, live MCP call, or pose synthesis. */
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {runPipeline, decodePNG, extractFrames, cleanAlpha, inspectImage} from '../../../lib/motion-engine.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const engine=await readFile(resolve(root,'../../../lib/motion-engine.mjs'));
const expectedEngine='00f584ec0799072983f80914929fc7ddf304731be28ab773b0c31fa1f9277659';
assert.equal(hash(engine),expectedEngine,'Production engine unchanged from the demo baseline');
const input=await readFile(resolve(root,'golf-swing-input.png'));
const options={name:'golf-swing',fps:2,source:{kind:'grid',columns:4,rows:2,count:8,margin:0,spacing:0},alphaThreshold:0,normalize:{trim:false,padding:0,width:192,height:192,align:'center'},atlasColumns:4};
const out=runPipeline(new Uint8Array(input),options,true);
assert.deepEqual(out.summary,{frameCount:8,frameWidth:192,frameHeight:192,atlasWidth:768,atlasHeight:384,fps:2});
assert(8*192*192+768*384<=1000000);
const files={'golf-swing-atlas.png':out.atlasPng,'golf-swing-atlas.json':out.atlasJSON+'\n','golf-swing-frames.zip':out.sequenceZip,'golf-swing-options.json':JSON.stringify(options,null,2)+'\n'};
await mkdir(resolve(root,'frames'),{recursive:true});
for(const[n,b]of Object.entries(files))await writeFile(resolve(root,n),b);
const zip=unzipSync(out.sequenceZip),src=extractFrames(decodePNG(input),options.source),atlas=extractFrames(decodePNG(out.atlasPng),options.source);
assert.equal(Object.keys(zip).length,9);
const frames=[];
for(let i=0;i<8;i++){
 const name=out.metadata.frames[i].filename,b=zip[name],actual=decodePNG(b),expected=cleanAlpha(src[i],0);
 assert.deepEqual(actual.data,expected.data,`Source cell ${i+1} exact match after transparent-black canonicalization`);
 assert.deepEqual(actual.data,atlas[i].data,`Atlas cell ${i+1} exact match`);
 assert.equal(out.metadata.frames[i].frame.x,(i%4)*192);
 assert.equal(out.metadata.frames[i].frame.y,Math.floor(i/4)*192);
 assert.equal(out.metadata.frames[i].duration,500);
 await writeFile(resolve(root,'frames',name),b);
 let differs=0;const next=cleanAlpha(src[(i+1)%8],0);
 for(let p=0;p<actual.data.length;p+=4)if(actual.data.subarray(p,p+4).some((v,k)=>v!==next.data[p+k]))differs++;
 assert(differs>0);
 frames.push({name,bytes:b.length,sha256:hash(b),sourceCellExactMatch:true,atlasCellExactMatch:true,nextFrameDifferentPixels:differs,inspection:inspectImage(actual)});
}
const again=runPipeline(new Uint8Array(input),options,true);
assert.equal(hash(again.atlasPng),hash(out.atlasPng));assert.equal(hash(again.sequenceZip),hash(out.sequenceZip));assert.equal(again.atlasJSON,out.atlasJSON);
const report={scope:'Local unchanged production runPipeline; not live MCP or UI verification',engine:{path:'lib/motion-engine.mjs',sha256:hash(engine),unchanged:true},input:{path:'golf-swing-input.png',bytes:input.length,sha256:hash(input),inspection:out.inspection},options,summary:out.summary,budgets:{inputPixels:768*384,framePixels:8*192*192,atlasPixels:768*384,combinedOutputPixels:589824,maxCombinedOutputPixels:1000000},files:Object.fromEntries(Object.entries(files).map(([n,b])=>[n,{bytes:Buffer.byteLength(b),sha256:hash(b)}])),frames,verification:{sourceCellOrderAndPixels:true,atlasFramePixels:true,zipEntries:9,repeatPipelineByteIdentical:true,nonzeroAlphaPreserved:true,invisibleRgbCanonicalizedAtAlphaZero:true},limitations:'The engine only extracts pre-drawn AI poses. Loop metadata is a playback hint; it does not guarantee seamless motion or swing accuracy.'};
await writeFile(resolve(root,'engine-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary:out.summary,budgets:report.budgets,verification:report.verification},null,2));
