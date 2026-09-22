import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import {plaidConfig} from '../_shared/plaid.ts';
import {revokeConnection} from './core.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{...cors,'Cache-Control':'no-store'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return reply({error:'Sign in'},401);
 try{
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
  const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const {data:{user},error}=await client.auth.getUser();if(error||!user)return reply({error:'Sign in'},401);
  const {connection_id}=await req.json();if(typeof connection_id!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(connection_id))return reply({error:'Invalid connection'},400);
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {environment,secret,client_id,baseUrl}=plaidConfig(Deno.env.get);
  const result=await revokeConnection({begin:async()=>{const r=await admin.rpc('begin_plaid_disconnect',{p_user_id:user.id,p_connection_id:connection_id});if(r.error||!r.data)throw new Error('Unavailable');if(!r.data.done&&r.data.environment!==environment)throw new Error('Environment mismatch');return r.data;},
   remove:async access_token=>{const r=await fetch(baseUrl+'/item/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id,secret,access_token}),signal:AbortSignal.timeout(20000)});if(!r.ok){const body=await r.json();if(!['ITEM_NOT_FOUND','INVALID_ACCESS_TOKEN'].includes(body.error_code))throw new Error('Revoke pending');}},
   finish:async()=>{const r=await admin.rpc('finish_plaid_disconnect',{p_user_id:user.id,p_connection_id:connection_id});if(r.error)throw new Error('Pending');}});
  return reply(result);
 }catch{return reply({error:'Disconnection could not be confirmed. Sync is paused if disconnection started. Retry disconnect to finish revoking Plaid access.'},503);}
});
