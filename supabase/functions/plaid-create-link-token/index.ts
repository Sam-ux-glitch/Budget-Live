import {createLinkToken} from './core.ts';
import {cors,reply,failure,PlaidFailure} from '../_shared/plaid.ts';
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply({code:'METHOD_NOT_ALLOWED'},405);
 try{
  const auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return reply({code:'SIGN_IN_REQUIRED'},401);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_ANON_KEY')??Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if(!url||!key)throw new PlaidFailure('BANK_CONFIGURATION_ERROR');
  const verified=await fetch(url+'/auth/v1/user',{headers:{authorization:auth,apikey:key},signal:AbortSignal.timeout(10000)});
  if(!verified.ok)return reply({code:'SIGN_IN_REQUIRED'},401);const user=await verified.json();if(typeof user.id!=='string')return reply({code:'SIGN_IN_REQUIRED'},401);
  const body=await req.json().catch(()=>{throw new PlaidFailure('INVALID_REQUEST',400);});return reply(await createLinkToken(user.id,body,name=>Deno.env.get(name)));
 }catch(error){return failure(error);}
});
