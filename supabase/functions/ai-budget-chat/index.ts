import { createChatHandler } from '../../../app/lib/chat-server.ts';
const handle = createChatHandler({url:Deno.env.get('SUPABASE_URL'),publishableKey:Deno.env.get('SUPABASE_ANON_KEY'),apiKey:Deno.env.get('OPENAI_API_KEY'),model:'gpt-5.6-luna'});
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok',{headers:cors});
  const response = await handle(request);
  for (const [key,value] of Object.entries(cors)) response.headers.set(key,value);
  return response;
});
