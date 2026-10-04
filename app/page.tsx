import Studio from './studio';
import { getChatGPTUser, chatGPTSignInPath } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
// The public shell has no saved user data. Processing stays authenticated.
export default async function Home(){const user=await getChatGPTUser();return <Studio signedIn={Boolean(user)} signInPath={chatGPTSignInPath('/')} />;}
