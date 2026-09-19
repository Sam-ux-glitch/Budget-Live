import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { collectSync, SyncError, type SyncPage } from "./core.ts";
const cors = { 'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS' };
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,
  headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return reply({error:'Method not allowed'},405);
  const auth=req.headers.get('Authorization');
  if(!auth?.startsWith('Bearer ')) return reply({error:'Sign in to sync your accounts'},401);
  try {
    const url=Deno.env.get('SUPABASE_URL')!;
    const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
    const {data:{user},error:authError}=await userClient.auth.getUser();
    if(authError || !user) return reply({error:'Sign in to sync your accounts'},401);
    let body: {connection_id?:string};
    try { body=await req.json(); } catch { return reply({error:'Invalid request'},400); }
    if(!body || typeof body!=='object' || Array.isArray(body) ||
      (body.connection_id!==undefined && (typeof body.connection_id!=='string' ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.connection_id)))) return reply({error:'Invalid connection'},400);
    const admin=createClient(url,service,{auth:{persistSession:false}});
    let query=admin.from('bank_connections').select('id,plaid_item_id').eq('user_id',user.id).eq('status','active');
    if(body.connection_id) query=query.eq('id',body.connection_id);
    const {data:connections,error:connectionError}=await query;
    if(connectionError) throw new SyncError('DATABASE_ERROR');
    if(!connections?.length) return reply({error:'No active bank connection found'},404);
    const clientId=Deno.env.get('PLAID_CLIENT_ID');
    // Matches the existing Sandbox-only Link/exchange functions. Never guess an environment from a token.
    const secret=Deno.env.get('PLAID_SANDBOX_SECRET') || Deno.env.get('PLAID_SECRET');
    if(!clientId || !secret) throw new SyncError('CONFIGURATION_ERROR');
    const results=[];
    for(const connection of connections) {
      try {
        const {data:record,error:recordError}=await admin.from('plaid_private_tokens')
          .select('sync_cursor').eq('user_id',user.id).eq('plaid_item_id',connection.plaid_item_id).single();
        if(recordError || !record) throw new SyncError('CONNECTION_UNAVAILABLE');
        const {data:accessToken,error:tokenError}=await admin.rpc('read_plaid_sync_token',
          {p_user_id:user.id,p_item_id:connection.plaid_item_id});
        if(tokenError || typeof accessToken!=='string') throw new SyncError('CONNECTION_UNAVAILABLE');
        const batch=await collectSync(record.sync_cursor,async(cursor)=>{
          const response=await fetch('https://sandbox.plaid.com/transactions/sync',{
            method:'POST',headers:{'Content-Type':'application/json','Plaid-Version':'2020-09-14'},
            body:JSON.stringify({client_id:clientId,secret,access_token:accessToken,count:500,...(cursor?{cursor}:{})}),
            signal:AbortSignal.timeout(20000),
          });
          const data=await response.json();
          if(!response.ok) {
            const allowed=['TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION','ITEM_LOGIN_REQUIRED','PRODUCT_NOT_READY'];
            throw new SyncError(allowed.includes(data.error_code)?data.error_code:'PLAID_UNAVAILABLE');
          }
          return data as SyncPage;
        });
        const {data:applied,error:applyError}=await admin.rpc('apply_plaid_sync',{
          p_user_id:user.id,p_item_id:connection.plaid_item_id,p_expected_cursor:record.sync_cursor,
          p_next_cursor:batch.cursor,p_accounts:batch.accounts,p_transactions:batch.transactions,p_removed:batch.removed,
        });
        if(applyError) throw new SyncError(applyError.code==='40001'?'SYNC_RETRY_REQUIRED':'DATABASE_ERROR');
        results.push({connection_id:connection.id,success:true,...applied,update_status:batch.status});
      } catch(error) {
        const code=error instanceof SyncError?error.code:'SYNC_UNAVAILABLE';
        // Never return or log upstream bodies, tokens, database errors, or transaction details.
        results.push({connection_id:connection.id,success:false,error:code});
      }
    }
    return reply({success:results.every(r=>r.success),results});
  } catch {
    return reply({error:'Sync is temporarily unavailable. Please try again.'},503);
  }
});
