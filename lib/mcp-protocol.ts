import { requireIdentity, readJSON, inspectInput, processInput, errorResponse, LIMITS } from './motion-service';
const integer = (minimum:number, maximum:number) => ({type:'integer',minimum,maximum});
const optionsSchema = {type:'object',additionalProperties:false,properties:{name:{type:'string',maxLength:48,pattern:'^[A-Za-z0-9_-]+$'},fps:integer(1,60),alphaThreshold:integer(0,254),atlasColumns:integer(1,64),source:{oneOf:[{type:'object',additionalProperties:false,properties:{kind:{const:'single'}},required:['kind']},{type:'object',additionalProperties:false,properties:{kind:{const:'grid'},columns:integer(1,64),rows:integer(1,64),count:integer(1,64),margin:integer(0,512),spacing:integer(0,512)},required:['kind','columns','rows']},{type:'object',additionalProperties:false,properties:{kind:{const:'rects'},rects:{type:'array',minItems:1,maxItems:64,items:{type:'object',additionalProperties:false,properties:{x:integer(0,4096),y:integer(0,4096),width:integer(1,2048),height:integer(1,2048)},required:['x','y','width','height']}}},required:['kind','rects']}]},normalize:{type:'object',additionalProperties:false,properties:{width:integer(1,2048),height:integer(1,2048),padding:integer(0,256),align:{enum:['center','bottom']},trim:{type:'boolean'}}},motion:{type:'object',additionalProperties:false,properties:{frames:integer(1,64),dx:integer(-256,256),dy:integer(-256,256)},required:['frames','dx','dy']}}};
const png = {type:'string',minLength:32,maxLength:2666668,description:'Standard base64 PNG bytes. Do not include a data URL or remote URL.'};
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
export const tools = [
{name:'motion_capabilities',description:'Read Dot Motion Studio format support and safety limits. Does not inspect files.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations},
{name:'inspect_png',description:'Inspect an authorized PNG image for dimensions and alpha. Requires signed-in user identity. No files are retained.',inputSchema:{type:'object',properties:{pngBase64:png},required:['pngBase64'],additionalProperties:false},annotations},
{name:'build_sprite',description:'Process an authorized PNG into a transparent sprite atlas plus JSON timing metadata. Optional ZIP contains individual PNG frames. Explicit grid or bounds, deterministic alpha threshold, normalization and constant 2D translation only. No AI generation or semantic background removal. No files are retained.',inputSchema:{type:'object',properties:{pngBase64:png,options:optionsSchema,includeSequenceZip:{type:'boolean',default:false}},required:['pngBase64'],additionalProperties:false},annotations}
];
const capabilities={version:'1.0.0',formats:{input:['PNG (static, non-interlaced; output RGBA8)'],output:['PNG atlas','JSON metadata','PNG sequence ZIP']},limits:LIMITS,features:['explicit grid/rect frame extraction','alpha threshold cleanup','uniform transparent canvas and alignment','integer constant 2D translation','frame timing metadata'],notSupported:['AI generation','semantic background removal','interpolated character animation','video','3D or motion capture'],retention:'Images and exports are processed in memory for each request and not saved by the app.'};
function response(id:unknown,result:unknown){return Response.json({jsonrpc:'2.0',id,result},{headers:{'Cache-Control':'no-store'}});}
function rpcError(id:unknown,code:number,message:string,status=200){return Response.json({jsonrpc:'2.0',id,error:{code,message}},{status,headers:{'Cache-Control':'no-store'}});}
function textResult(value:unknown){return {content:[{type:'text',text:JSON.stringify(value)}]};}
export async function handleMCP(request:Request){
 let rpc: {jsonrpc?:unknown;id?:unknown;method?:unknown;params?:{name?:string;arguments?:Record<string,unknown>;protocolVersion?:string}};
 try {rpc=await readJSON(request);}catch(error){return errorResponse(error);}
 if(!rpc || Array.isArray(rpc) || rpc.jsonrpc!=='2.0' || typeof rpc.method!=='string')return rpcError(rpc?.id??null,-32600,'Invalid JSON-RPC request.');
 const id=rpc.id??null;
 if(rpc.method==='notifications/initialized')return new Response(null,{status:202});
 if(rpc.method==='initialize')return response(id,{protocolVersion:rpc.params?.protocolVersion==='2025-03-26'?'2025-03-26':'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'dot-motion-studio',version:'1.0.0'},instructions:'Use only user-authorized PNGs. All image-processing calls require a trusted signed-in user. Outputs are ephemeral; save requested exports before the conversation ends.'});
 if(rpc.method==='ping')return response(id,{});
 if(rpc.method==='tools/list')return response(id,{tools});
 if(rpc.method==='resources/list')return response(id,{resources:[]});
 if(rpc.method==='prompts/list')return response(id,{prompts:[]});
 if(rpc.method!=='tools/call')return rpcError(id,-32601,'Method not found.');
 try {
   const name=rpc.params?.name; const args=rpc.params?.arguments===undefined?{}:rpc.params.arguments;
   if(!args || typeof args!=='object' || Array.isArray(args))return rpcError(id,-32602,'Arguments must be an object.');
   if(name==='motion_capabilities')return response(id,textResult(capabilities));
   if(!['inspect_png','build_sprite'].includes(name??''))return rpcError(id,-32602,'Unknown tool.');
   requireIdentity(request);
   const permitted=name==='inspect_png'?['pngBase64']:['pngBase64','options','includeSequenceZip'];
   if(Object.keys(args).some(k=>!permitted.includes(k)))return rpcError(id,-32602,'Unsupported argument.');
   if(name==='inspect_png')return response(id,textResult(inspectInput(args)));
   if(args.includeSequenceZip!==undefined && typeof args.includeSequenceZip!=='boolean')return rpcError(id,-32602,'includeSequenceZip must be a boolean.');
   const result=processInput(args,args.includeSequenceZip===true);
   const content:Record<string,unknown>[]=[{type:'text',text:JSON.stringify({summary:result.summary,metadata:result.metadata,inspection:result.inspection})},{type:'image',mimeType:'image/png',data:result.atlasBase64}];
   if(args.includeSequenceZip===true)content.push({type:'resource',resource:{uri:'motion://exports/sprite-frames.zip',mimeType:'application/zip',blob:result.sequenceZipBase64}});
   return response(id,{content});
 }catch(error){
   if(error instanceof Error && 'status' in error && error.status===401)return rpcError(id,-32001,error.message,401);
   return response(id,{isError:true,content:[{type:'text',text:error instanceof Error?error.message:'Processing failed.'}]});
 }
}
