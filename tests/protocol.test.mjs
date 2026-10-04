import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {encodePNG,decodePNG} from '../lib/motion-engine.mjs';
const root=new URL('../',import.meta.url);const temp=await mkdtemp(join(tmpdir(),'dot-motion-protocol-'));
const engineURL=new URL('lib/motion-engine.mjs',root).href;
const serviceSource=(await readFile(new URL('lib/motion-service.ts',root),'utf8')).replace("'./motion-engine.mjs'",JSON.stringify(engineURL));
await writeFile(join(temp,'service.mjs'),ts.transpileModule(serviceSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const mcpSource=(await readFile(new URL('lib/mcp-protocol.ts',root),'utf8')).replace("'./motion-service'","'./service.mjs'");
await writeFile(join(temp,'mcp.mjs'),ts.transpileModule(mcpSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {handleMCP}=await import(pathToFileURL(join(temp,'mcp.mjs')).href);
const {processInput,inspectInput,readJSON}=await import(pathToFileURL(join(temp,'service.mjs')).href);
const data=new Uint8Array(8*8*4);for(let y=2;y<6;y++)for(let x=2;x<6;x++)data.set([23,175,201,255],(y*8+x)*4);
const b64=Buffer.from(encodePNG({width:8,height:8,data})).toString('base64');
function request(method,params={},auth=false){return new Request('https://studio.example/mcp',{method:'POST',headers:{'content-type':'application/json',...(auth?{'oai-authenticated-user-id':'test-user'}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});}
await test('MCP initialization and discovery expose schema without user data',async()=>{const init=await handleMCP(request('initialize'));assert.equal(init.status,200);const x=await init.json();assert.equal(x.result.serverInfo.name,'dot-motion-studio');const list=await (await handleMCP(request('tools/list'))).json();assert.deepEqual(list.result.tools.map(t=>t.name),['motion_capabilities','inspect_png','build_sprite']);assert.equal(list.result.tools[2].inputSchema.additionalProperties,false);});
await test('MCP negotiates the supported client version',async()=>{for(const version of ['2025-03-26','2025-06-18']){const r=await (await handleMCP(request('initialize',{protocolVersion:version}))).json();assert.equal(r.result.protocolVersion,version);}});
await test('Data-bearing MCP calls require trusted user identity',async()=>{for(const name of ['inspect_png','build_sprite']){const r=await handleMCP(request('tools/call',{name,arguments:{pngBase64:b64}}));assert.equal(r.status,401);assert.equal((await r.json()).error.code,-32001);}});
await test('Authenticated inspection measures actual transparent pixels',async()=>{const r=await handleMCP(request('tools/call',{name:'inspect_png',arguments:{pngBase64:b64}},true));const body=await r.json();const i=JSON.parse(body.result.content[0].text);assert.equal(i.transparentPixels,48);assert.equal(i.opaquePixels,16);assert.equal(i.width,8);});
await test('Authenticated build returns PNG + metadata + requested ZIP',async()=>{const r=await handleMCP(request('tools/call',{name:'build_sprite',arguments:{pngBase64:b64,options:{source:{kind:'single'},motion:{frames:3,dx:2,dy:-1},fps:12},includeSequenceZip:true}},true));const body=await r.json();assert.equal(body.result.isError,undefined);assert.equal(body.result.content.length,3);const summary=JSON.parse(body.result.content[0].text).summary;assert.equal(summary.frameCount,3);const atlas=decodePNG(new Uint8Array(Buffer.from(body.result.content[1].data,'base64')));assert.equal(atlas.width,summary.atlasWidth);assert.equal(body.result.content[2].resource.mimeType,'application/zip');});
await test('Service rejects remote URLs, bad filenames as schema or safe sanitization, invalid types and overlarge bodies',async()=>{assert.throws(()=>inspectInput({pngBase64:'https://example.com/image.png'}));assert.throws(()=>inspectInput({pngBase64:'A'.repeat(2666672)}));assert.throws(()=>processInput({pngBase64:b64,options:{url:'http://internal'}}));assert.throws(()=>processInput({pngBase64:b64,options:{motion:{frames:65,dx:1,dy:0}}}));const response=await handleMCP(request('tools/call',{name:'build_sprite',arguments:{pngBase64:b64,path:'../../secret'}},true));assert.equal((await response.json()).error.code,-32602);const huge=new Request('https://studio.example/api/process',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'3000001'},body:'{}'});await assert.rejects(()=>readJSON(huge));});
await test('RPC unknown methods, invalid JSON and initialized notifications are bounded',async()=>{assert.equal((await (await handleMCP(request('unknown'))).json()).error.code,-32601);assert.equal((await handleMCP(request('notifications/initialized'))).status,202);const r=await handleMCP(new Request('https://studio.example/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'}));assert.equal(r.status,400);});
await test('MCP validates includeSequenceZip type while preserving omitted, false, and true behavior',async()=>{
  for(const value of ['yes','true',1,0,null,{},[]]){
    const r=await (await handleMCP(request('tools/call',{name:'build_sprite',arguments:{pngBase64:b64,includeSequenceZip:value}},true))).json();
    assert.equal(r.error.code,-32602);assert.equal(r.error.message,'includeSequenceZip must be a boolean.');
  }
  for(const value of [undefined,false,true]){
    const args={pngBase64:b64,...(value===undefined?{}:{includeSequenceZip:value})};
    const r=await (await handleMCP(request('tools/call',{name:'build_sprite',arguments:args},true))).json();
    assert.equal(r.result.isError,undefined);assert.equal(r.result.content.length,value===true?3:2);
  }
});
await rm(temp,{recursive:true,force:true});
