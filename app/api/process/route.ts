import { requireIdentity, readJSON, processInput, errorResponse } from '../../../lib/motion-service';
export async function POST(request: Request) { try {requireIdentity(request); return Response.json(processInput(await readJSON(request)),{headers:{'Cache-Control':'no-store'}});} catch(error) {return errorResponse(error);} }
