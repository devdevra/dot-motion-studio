import { requireIdentity, readJSON, inspectInput, errorResponse } from '../../../lib/motion-service';
export async function POST(request: Request) { try {requireIdentity(request); return Response.json(inspectInput(await readJSON(request)),{headers:{'Cache-Control':'no-store'}});} catch(error) {return errorResponse(error);} }
