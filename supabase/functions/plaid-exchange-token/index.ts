import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import {plaidConfig,PlaidFailure,cors,reply,failure} from '../_shared/plaid.ts';
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return reply({code:'SIGN_IN_REQUIRED'},401);
 try{
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
  const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const {data:{user},error}=await client.auth.getUser();if(error||!user)return reply({code:'SIGN_IN_REQUIRED'},401);
  let body;try{body=await req.json();}catch{throw new PlaidFailure('INVALID_REQUEST',400);}
  const config=plaidConfig(Deno.env.get);
  if(!body||typeof body.public_token!=='string'||body.public_token.length>1024||!body.public_token.startsWith('public-'+config.environment+'-'))throw new PlaidFailure('INVALID_REQUEST',400);
  const response=await fetch(config.baseUrl+'/item/public_token/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:config.client_id,secret:config.secret,public_token:body.public_token}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new PlaidFailure('PLAID_EXCHANGE_UNAVAILABLE',502);
  const data=await response.json();if(typeof data.access_token!=='string'||typeof data.item_id!=='string')throw new PlaidFailure('PLAID_EXCHANGE_UNAVAILABLE',502);
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const stored=await admin.rpc('register_plaid_connection',{p_user_id:user.id,p_item_id:data.item_id,p_access_token:data.access_token,p_environment:config.environment});
  if(stored.error){
   // The database transaction rolls back completely; revoke the new remote Item too.
   try{const revoked=await fetch(config.baseUrl+'/item/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:config.client_id,secret:config.secret,access_token:data.access_token}),signal:AbortSignal.timeout(20000)});if(!revoked.ok)console.error('plaid_exchange_cleanup_failed');}catch{console.error('plaid_exchange_cleanup_failed');}
   throw new PlaidFailure('BANK_STORAGE_UNAVAILABLE');
  }
  return reply({success:true});
 }catch(error){return failure(error);}
});
