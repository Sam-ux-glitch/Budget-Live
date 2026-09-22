-- Preserve the reviewed live security state and make it reproducible.
begin;
revoke create on schema public from public,anon,authenticated;
revoke truncate,trigger,references on all tables in schema public from anon,authenticated;
alter table public.bank_connections add column if not exists plaid_environment text not null default 'sandbox' check(plaid_environment in ('sandbox','production'));
CREATE OR REPLACE FUNCTION public.create_month_income(target_month date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 month_start date := date_trunc('month', target_month)::date;
 expected numeric;
begin
 expected := public.calculate_expected_income(month_start);

 insert into public.monthly_income (
 user_id,
 month,
 expected_income,
 actual_income
 )
 values (
 auth.uid(),
 month_start,
 expected,
 0
 )
 on conflict (user_id, month)
 do update set
 expected_income = excluded.expected_income;
end;
$function$;

CREATE OR REPLACE FUNCTION public.read_plaid_sync_token(p_user_id uuid, p_item_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare token text;
begin
 if not exists (select 1 from public.plaid_private_tokens p
 join public.bank_connections b on b.plaid_item_id=p.plaid_item_id and b.user_id=p.user_id
 where p.user_id=p_user_id and p.plaid_item_id=p_item_id and b.status='active') then
 raise exception 'Active connection not found';
 end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='plaid_' || p_item_id;
 if token is null then raise exception 'Vault token unavailable'; end if;
 return token;
end $function$;

CREATE OR REPLACE FUNCTION public.begin_plaid_disconnect(p_user_id uuid, p_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare c public.bank_connections; token text;
begin
 select * into strict c from public.bank_connections where id=p_connection_id and user_id=p_user_id for update;
 if c.status='disconnected' then return jsonb_build_object('done',true);end if;
 if not exists(select 1 from public.plaid_private_tokens where user_id=p_user_id and plaid_item_id=c.plaid_item_id) then raise exception 'Connection unavailable';end if;
 select decrypted_secret into strict token from vault.decrypted_secrets where name='plaid_'||c.plaid_item_id;
 update public.bank_connections set status='disconnect_pending' where id=c.id and user_id=p_user_id;
 return jsonb_build_object('done',false,'access_token',token);
end $function$;

CREATE OR REPLACE FUNCTION public.finish_plaid_disconnect(p_user_id uuid, p_connection_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_item_id text;
begin
 select plaid_item_id
 into strict v_item_id
 from public.bank_connections
 where id = p_connection_id
 and user_id = p_user_id
 and status in ('disconnect_pending', 'disconnected')
 for update;

 update public.bank_connections
 set status = 'disconnected'
 where id = p_connection_id
 and user_id = p_user_id;

 delete from public.plaid_private_tokens
 where user_id = p_user_id
 and plaid_item_id = v_item_id;

 delete from vault.secrets
 where name = 'plaid_' || v_item_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.store_plaid_token_in_vault(token_value text, token_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if exists (
 select 1
 from vault.secrets
 where name = token_name
 ) then
 perform vault.update_secret(
 (select id from vault.secrets where name = token_name),
 token_value,
 token_name,
 'Plaid access token for Budget Live'
 );
 else
 perform vault.create_secret(
 token_value,
 token_name,
 'Plaid access token for Budget Live'
 );
 end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_plaid_sync(p_user_id uuid, p_item_id text, p_expected_cursor text, p_next_cursor text, p_accounts jsonb, p_transactions jsonb, p_removed jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 current_cursor text; connection_id uuid; institution text; account_uuid uuid;
 a jsonb; t jsonb; old_pending public.transactions%rowtype;
 imported integer:=0; removed_count integer:=0;
begin
 select sync_cursor into current_cursor from public.plaid_private_tokens
 where user_id=p_user_id and plaid_item_id=p_item_id for update;
 if not found then raise exception 'Connection not found'; end if;
 if current_cursor is distinct from p_expected_cursor then
 raise exception 'Sync changed; retry' using errcode='40001';
 end if;
 select id,institution_name into connection_id,institution from public.bank_connections
 where user_id=p_user_id and plaid_item_id=p_item_id and status='active' for update;
 if not found then raise exception 'Active connection not found'; end if;
 if p_next_cursor is null or p_next_cursor='' then raise exception 'Missing next cursor'; end if;
 if jsonb_typeof(p_accounts) <> 'array' or jsonb_typeof(p_transactions) <> 'array'
 or jsonb_typeof(p_removed) <> 'array' then raise exception 'Invalid sync payload'; end if;

 for a in select value from jsonb_array_elements(p_accounts) loop
 if nullif(a->>'account_id','') is null then raise exception 'Missing account ID'; end if;
 if exists(select 1 from public.accounts where external_id=a->>'account_id'
 and (user_id<>p_user_id or bank_connection_id is distinct from connection_id)) then
 raise exception 'Account ownership conflict';
 end if;
 insert into public.accounts(user_id,external_id,bank_connection_id,institution_name,account_name,account_type,last4,is_active)
 values(p_user_id,a->>'account_id',connection_id,institution,coalesce(a->>'name','Bank account'),a->>'type',a->>'mask',true)
 on conflict(external_id) do update set account_name=excluded.account_name,
 account_type=excluded.account_type,last4=excluded.last4,is_active=true;
 end loop;

 for t in select value from jsonb_array_elements(p_transactions) loop
 account_uuid:=null;
 select id into account_uuid from public.accounts where user_id=p_user_id
 and bank_connection_id=connection_id and external_id=t->>'account_id';
 if account_uuid is null then raise exception 'Transaction account not found'; end if;
 if nullif(t->>'transaction_id','') is null then raise exception 'Missing transaction ID'; end if;
 if exists(select 1 from public.transactions where external_id=t->>'transaction_id'
 and (user_id<>p_user_id or account_id is distinct from account_uuid)) then
 raise exception 'Transaction ownership conflict';
 end if;
 -- Reuse the pending row's identity so manual category choices and references survive posting.
 if nullif(t->>'pending_transaction_id','') is not null then
 select * into old_pending from public.transactions where user_id=p_user_id
 and account_id=account_uuid and external_id=t->>'pending_transaction_id' for update;
 if found and not exists(select 1 from public.transactions where external_id=t->>'transaction_id') then
 update public.transactions set external_id=t->>'transaction_id' where id=old_pending.id;
 end if;
 end if;
 insert into public.transactions as existing
 (user_id,external_id,account_id,account_name,transaction_date,merchant_name,description,amount,
 is_pending,plaid_category_primary,plaid_category_detailed,plaid_merchant_entity_id,
 is_transfer,excluded_from_budget,needs_review,review_reason,iso_currency_code,pending_external_id,plaid_removed_at)
 values(p_user_id,t->>'transaction_id',account_uuid,
 (select account_name from public.accounts where id=account_uuid),(t->>'date')::date,
 t->>'merchant_name',t->>'name',(t->>'amount')::numeric,(t->>'pending')::boolean,
 t->>'category_primary',t->>'category_detailed',t->>'merchant_entity_id',
 (t->>'is_transfer')::boolean,(t->>'excluded_from_budget')::boolean,
 (t->>'needs_review')::boolean,t->>'review_reason',t->>'iso_currency_code',t->>'pending_transaction_id',null)
 on conflict(external_id) do update set
 transaction_date=excluded.transaction_date,merchant_name=excluded.merchant_name,
 description=excluded.description,amount=excluded.amount,account_name=excluded.account_name,
 is_pending=excluded.is_pending,plaid_category_primary=excluded.plaid_category_primary,
 plaid_category_detailed=excluded.plaid_category_detailed,plaid_merchant_entity_id=excluded.plaid_merchant_entity_id,
 iso_currency_code=excluded.iso_currency_code,pending_external_id=excluded.pending_external_id,plaid_removed_at=null,
 is_transfer=case when existing.user_category_confirmed then existing.is_transfer else excluded.is_transfer end,
 excluded_from_budget=case when existing.user_category_confirmed then existing.excluded_from_budget else excluded.excluded_from_budget end,
 needs_review=case when existing.user_category_confirmed then existing.needs_review else excluded.needs_review end,
 review_reason=case when existing.user_category_confirmed then existing.review_reason else excluded.review_reason end;
 imported:=imported+1;
 end loop;
 -- Soft removal preserves history and all attached user corrections.
 update public.transactions t set plaid_removed_at=now(),excluded_from_budget=true
 where t.user_id=p_user_id and t.account_id in
 (select id from public.accounts where user_id=p_user_id and bank_connection_id=connection_id)
 and t.external_id in (select value #>> '{}' from jsonb_array_elements(p_removed));
 get diagnostics removed_count=row_count;
 update public.plaid_private_tokens set sync_cursor=p_next_cursor,updated_at=now()
 where user_id=p_user_id and plaid_item_id=p_item_id;
 update public.bank_connections set last_synced_at=now() where id=connection_id and user_id=p_user_id;
 return jsonb_build_object('processed',imported,'removed',removed_count);
end $function$;

-- Explicitly put pg_temp last so privileged unqualified names cannot be shadowed.
do $$ declare f record; begin for f in select p.oid::regprocedure as signature,has_function_privilege('authenticated',p.oid,'EXECUTE') as allow_auth,has_function_privilege('service_role',p.oid,'EXECUTE') as allow_service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' loop
 execute format('revoke execute on function %s from public,anon',f.signature);
 if f.allow_auth then execute format('grant execute on function %s to authenticated',f.signature);end if;
 if f.allow_service then execute format('grant execute on function %s to service_role',f.signature);end if;
 execute format('alter function %s set search_path = pg_catalog, public, pg_temp',f.signature);
end loop;end $$;
-- Vault functions use qualified names and a completely empty path.
alter function public.store_plaid_token_in_vault(text,text) set search_path='';
alter function public.read_plaid_sync_token(uuid,text) set search_path='';
alter function public.apply_plaid_sync(uuid,text,text,text,jsonb,jsonb,jsonb) set search_path='';
alter function public.finish_plaid_disconnect(uuid,uuid) set search_path='';
revoke all on public.plaid_private_tokens from public,anon,authenticated;
revoke all on function public.begin_plaid_disconnect(uuid,uuid),public.finish_plaid_disconnect(uuid,uuid),public.read_plaid_sync_token(uuid,text),public.store_plaid_token_in_vault(text,text),public.apply_plaid_sync(uuid,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.begin_plaid_disconnect(uuid,uuid),public.finish_plaid_disconnect(uuid,uuid),public.read_plaid_sync_token(uuid,text),public.store_plaid_token_in_vault(text,text),public.apply_plaid_sync(uuid,text,text,text,jsonb,jsonb,jsonb) to service_role;
create or replace function public.begin_plaid_disconnect(p_user_id uuid,p_connection_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.bank_connections; token text;
begin
 select * into strict c from public.bank_connections where id=p_connection_id and user_id=p_user_id for update;
 if c.status='disconnected' then perform public.finish_plaid_disconnect(p_user_id,p_connection_id);return jsonb_build_object('done',true);end if;
 update public.bank_connections set status='disconnect_pending' where id=c.id and user_id=p_user_id;
 if exists(select 1 from public.plaid_private_tokens where user_id=p_user_id and plaid_item_id=c.plaid_item_id) then
 select decrypted_secret into token from vault.decrypted_secrets where name='plaid_'||c.plaid_item_id;
 end if;
 return jsonb_build_object('done',false,'access_token',token,'environment',c.plaid_environment);
end $$;
create or replace function public.register_plaid_connection(p_user_id uuid,p_item_id text,p_access_token text,p_environment text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_user_id is null or nullif(p_item_id,'') is null or nullif(p_access_token,'') is null or p_environment is null or p_environment not in ('sandbox','production') then raise exception 'Invalid connection';end if;
 perform pg_advisory_xact_lock(hashtextextended('plaid:'||p_item_id,0));
 if exists(select 1 from public.bank_connections where plaid_item_id=p_item_id and (user_id<>p_user_id or plaid_environment<>p_environment)) or exists(select 1 from public.plaid_private_tokens where plaid_item_id=p_item_id and user_id<>p_user_id) then raise exception 'Connection ownership conflict';end if;
 perform public.store_plaid_token_in_vault(p_access_token,'plaid_'||p_item_id);
 insert into public.plaid_private_tokens(user_id,plaid_item_id,updated_at) values(p_user_id,p_item_id,now()) on conflict(plaid_item_id) do update set updated_at=excluded.updated_at;
 insert into public.bank_connections(user_id,plaid_item_id,status,plaid_environment,last_synced_at) values(p_user_id,p_item_id,'active',p_environment,null) on conflict(plaid_item_id) do update set status='active';
end $$;
revoke all on function public.register_plaid_connection(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.register_plaid_connection(uuid,text,text,text) to service_role;
commit;
