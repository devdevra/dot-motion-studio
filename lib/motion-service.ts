import { inspectPNG, inspectImage, decodePNG, runPipeline } from './motion-engine.mjs';

export const MAX_REQUEST_BYTES = 3_000_000;
export const LIMITS = { inputBytes: 2_000_000, inputPixels: 1_000_000, frames: 64, outputPixels: 1_000_000 };
export class RequestError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function requireIdentity(request: Request) {
  const id = request.headers.get('oai-authenticated-user-id');
  if (!id?.trim()) throw new RequestError('Sign in with ChatGPT to process an image.', 401);
  return id;
}
export async function readJSON(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new RequestError('Expected application/json.', 415);
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_REQUEST_BYTES) throw new RequestError('Request exceeds 3 MB.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('Request body is required.');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const {done,value} = await reader.read(); if(done) break; size += value.length; if(size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new RequestError('Request exceeds 3 MB.',413); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset=0; for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new RequestError('Invalid JSON.'); }
}
export function fromBase64(value: unknown) {
  if(typeof value !== 'string' || value.length < 32 || value.length > 2_666_668 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4) throw new RequestError('Provide a PNG as standard base64, no data URL; maximum 2 MB.');
  let raw: string; try { raw = atob(value); } catch { throw new RequestError('Invalid base64.'); }
  if(raw.length > LIMITS.inputBytes) throw new RequestError('PNG exceeds 2 MB.', 413);
  const bytes=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i); return bytes;
}
export function toBase64(bytes: Uint8Array) { let out=''; for(let i=0;i<bytes.length;i+=16384) out+=String.fromCharCode(...bytes.subarray(i,i+16384)); return btoa(out); }
export function inspectInput(body: {pngBase64?: unknown}) { const bytes=fromBase64(body.pngBase64); return {...inspectPNG(bytes), ...inspectImage(decodePNG(bytes))}; }
export function processInput(body: {pngBase64?:unknown; options?:unknown}, includeSequence = true) {
  if(body.options !== undefined && (!body.options || typeof body.options !== 'object' || Array.isArray(body.options))) throw new RequestError('Options must be an object.');
  const r = runPipeline(fromBase64(body.pngBase64),body.options ?? {}, includeSequence);
  if(r.atlasPng.length + r.sequenceZip.length > 3_000_000) throw new RequestError('Export is too large. Reduce frames or canvas dimensions.',413);
  return {inspection:r.inspection, summary:r.summary, metadata:r.metadata, atlasBase64:toBase64(r.atlasPng), sequenceZipBase64:toBase64(r.sequenceZip), atlasJSON:r.atlasJSON};
}
export function errorResponse(error: unknown) { const status=error instanceof RequestError?error.status:400; const message=error instanceof Error?error.message:'Could not process image.'; return Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}}); }
