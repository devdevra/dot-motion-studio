import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {encodePNG} from '../lib/motion-engine.mjs';

// Source-exact component logic test. React hooks, FileReader and fetch are mocked;
// this deliberately does not claim a browser, authenticated session or canvas test.
const root=new URL('../',import.meta.url),temp=await mkdtemp(join(tmpdir(),'dot-motion-settings-'));
await writeFile(join(temp,'hooks.mjs'),`
let hooks=[],index=0;
export function reset(){hooks=[];index=0;}
export function begin(){index=0;}
export function useState(initial){const i=index++;if(!(i in hooks))hooks[i]=initial;return[hooks[i],v=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];}
export function useRef(initial){const i=index++;if(!(i in hooks))hooks[i]={current:initial};return hooks[i];}
export function useEffect(){}
`);
const hooks=await import(pathToFileURL(join(temp,'hooks.mjs')).href);
const source=(await readFile(new URL('app/studio.tsx',root),'utf8'))
  .replace("'react'","'./hooks.mjs'")
  .replace("'lucide-react'",JSON.stringify(import.meta.resolve('lucide-react')))
  .replace("'../lib/request-gate.mjs'",JSON.stringify(new URL('lib/request-gate.mjs',root).href));
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  .replace('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime')));
await writeFile(join(temp,'studio.mjs'),compiled);
const {default:Studio}=await import(pathToFileURL(join(temp,'studio.mjs')).href);
const originalFetch=globalThis.fetch,originalReader=globalThis.FileReader;
let pending=[],tree;
globalThis.FileReader=class{readAsDataURL(file){this.result='data:image/png;base64,'+file.base64;queueMicrotask(()=>this.onload());}};
globalThis.fetch=(path,options)=>new Promise(resolve=>pending.push({path,body:JSON.parse(options.body),resolve}));
const fixture=name=>({name,type:'image/png',size:70,base64:Buffer.from(encodePNG({width:1,height:1,data:new Uint8Array([10,20,30,255])})).toString('base64')});
function nodes(e){if(!e||typeof e!=='object')return[];if(Array.isArray(e))return e.flatMap(nodes);if(typeof e.type==='function'&&e.type.name==='NumberField')return nodes(e.type(e.props));return[e,...nodes(e.props?.children)];}
function text(e){if(typeof e==='string'||typeof e==='number')return String(e);if(Array.isArray(e))return e.map(text).join('');return text(e?.props?.children??'');}
function render(){hooks.begin();tree=Studio({signedIn:true,signInPath:'/'});return tree;}
function reset(){hooks.reset();pending=[];render();}
const button=label=>nodes(tree).find(n=>n.type==='button'&&text(n).trim()===label);
const inputType=type=>nodes(tree).find(n=>n.type==='input'&&n.props.type===type);
const number=label=>nodes(nodes(tree).find(n=>n.type==='label'&&text(n).startsWith(label))).find(n=>n.type==='input');
const hasResult=()=>nodes(tree).some(n=>n.type==='canvas');
const error=()=>nodes(tree).find(n=>n.props?.role==='alert');
const status=()=>nodes(tree).find(n=>n.props?.role==='status');
async function selectFile(name){const done=inputType('file').props.onChange({target:{files:[fixture(name)]}});await new Promise(r=>setImmediate(r));render();return{done,request:pending.at(-1)};}
function answer(request,body,status=200){request.resolve(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}));}
function resultFor(request){return{summary:{frameCount:2,frameWidth:1,frameHeight:1,atlasWidth:2,atlasHeight:1,fps:request.body.options.fps},atlasBase64:fixture('a.png').base64,sequenceZipBase64:'',atlasJSON:'{}',inspection:{},metadata:{frames:[{frame:{x:0,y:0,w:1,h:1}},{frame:{x:1,y:0,w:1,h:1}}]}};}
async function ready(){const upload=await selectFile('A.png');answer(upload.request,{width:1,height:1});await upload.done;render();}
function startBuild(){const done=button('스프라이트 만들기').props.onClick();const request=pending.at(-1);render();return{done,request};}
async function buildResult(){const build=startBuild();answer(build.request,resultFor(build.request));await build.done;render();assert.equal(hasResult(),true);}

try{
 await test('Changing FPS during build discards the stale result and releases busy',async()=>{
  reset();await ready();const build=startBuild();number('재생 속도 · FPS').props.onChange({target:{value:'30'}});render();answer(build.request,resultFor(build.request));await build.done;render();
  assert.equal(number('재생 속도 · FPS').props.value,30);assert.match(text(status()),/새 결과/);assert.equal(hasResult(),false);assert.equal(button('스프라이트 만들기').props.disabled,false);
 });
 await test('Changing mode and geometry during build discards the prior result',async()=>{
  reset();await ready();const build=startBuild();button('시트 나누기').props.onClick();render();number('가로 칸').props.onChange({target:{value:'1'}});number('세로 칸').props.onChange({target:{value:'1'}});number('프레임 수').props.onChange({target:{value:'1'}});render();answer(build.request,resultFor(build.request));await build.done;render();assert.equal(hasResult(),false);assert.equal(inputType('checkbox').props.checked,false);
 });
 await test('Every processing option invalidates an existing result and resets frame',async()=>{
  const changes=[
   ['single',()=>number('재생 속도 · FPS').props.onChange({target:{value:'24'}})],
   ['single',()=>number('여백 · px').props.onChange({target:{value:'2'}})],
   ['single',()=>nodes(tree).find(n=>n.type==='select').props.onChange({target:{value:'bottom'}})],
   ['single',()=>inputType('checkbox').props.onChange({target:{checked:false}})],
   ['single',()=>nodes(tree).find(n=>n.props?.id==='alpha').props.onChange({target:{value:'30'}})],
   ['single',()=>button('시트 나누기').props.onClick()],
   ['grid',()=>number('가로 칸').props.onChange({target:{value:'3'}})],
   ['grid',()=>number('세로 칸').props.onChange({target:{value:'3'}})],
   ['grid',()=>number('프레임 수').props.onChange({target:{value:'3'}})],
   ['motion',()=>number('프레임 수').props.onChange({target:{value:'3'}})],
   ['motion',()=>number('X / 프레임').props.onChange({target:{value:'-3'}})],
   ['motion',()=>number('Y / 프레임').props.onChange({target:{value:'-3'}})],
  ];
  for(const[mode,change]of changes){reset();await ready();if(mode!=='single'){button(mode==='grid'?'시트 나누기':'2D 이동').props.onClick();render();}await buildResult();nodes(tree).find(n=>n.props?.['aria-label']==='프레임 위치').props.onChange({target:{value:'1'}});render();change();render();assert.equal(hasResult(),false);assert.equal(nodes(tree).find(n=>n.props?.['aria-label']==='프레임 위치').props.value,0);assert.equal(button('PNG 아틀라스모든 프레임 한 장에').props.disabled,true);assert.match(text(status()),/새 결과/);}
 });
 await test('New-file selection still invalidates an in-flight prior build',async()=>{
  reset();await ready();const build=startBuild();const newer=await selectFile('B.png');answer(newer.request,{width:1,height:1});await newer.done;render();answer(build.request,resultFor(build.request));await build.done;render();assert.ok(text(tree).includes('B.png'));assert.equal(hasResult(),false);assert.equal(button('스프라이트 만들기').props.disabled,false);
 });
 await test('Option edit during inspection does not invalidate the valid upload',async()=>{
  reset();const upload=await selectFile('A.png');number('재생 속도 · FPS').props.onChange({target:{value:'30'}});render();answer(upload.request,{width:1,height:1});await upload.done;render();assert.ok(text(tree).includes('A.png'));assert.equal(button('스프라이트 만들기').props.disabled,false);const build=startBuild();assert.equal(build.request.body.options.fps,30);answer(build.request,resultFor(build.request));await build.done;render();assert.equal(hasResult(),true);
 });
 await test('Stale build error is ignored after an option edit; busy still clears',async()=>{
  reset();await ready();const build=startBuild();number('여백 · px').props.onChange({target:{value:'2'}});render();answer(build.request,{error:'Old canvas was too large'},400);await build.done;render();assert.equal(error(),undefined);assert.equal(button('스프라이트 만들기').props.disabled,false);
 });
 await test('Unchanged settings still publish result; editing clears a previous error',async()=>{
  reset();await ready();await buildResult();assert.equal(status(),undefined);for(const label of ['PNG 아틀라스모든 프레임 한 장에','JSON 메타데이터좌표 · 타이밍 · 루프','PNG 프레임 ZIP개별 이미지 모음'])assert.equal(button(label).props.disabled,false);const build=startBuild();answer(build.request,{error:'Current request failed'},400);await build.done;render();assert.ok(error());number('재생 속도 · FPS').props.onChange({target:{value:'24'}});render();assert.equal(error(),undefined);assert.equal(hasResult(),false);
 });
 await test('New file and a successful rebuild clear the neutral settings hint',async()=>{
  reset();await ready();await buildResult();number('재생 속도 · FPS').props.onChange({target:{value:'24'}});render();assert.ok(status());await buildResult();assert.equal(status(),undefined);number('여백 · px').props.onChange({target:{value:'2'}});render();assert.ok(status());const next=await selectFile('B.png');answer(next.request,{width:1,height:1});await next.done;render();assert.equal(status(),undefined);
 });
}finally{globalThis.fetch=originalFetch;if(originalReader===undefined)delete globalThis.FileReader;else globalThis.FileReader=originalReader;await rm(temp,{recursive:true,force:true});}
