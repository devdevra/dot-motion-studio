import { handleMCP } from '../../lib/mcp-protocol';
export const POST = handleMCP;
export async function GET(){return new Response('Stateless MCP: use POST.',{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});}
