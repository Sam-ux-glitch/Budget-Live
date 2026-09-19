-- Budget Live: Vault-only Plaid sync. Existing tables are prerequisites.
begin;
alter table public.transactions add column if not exists plaid_removed_at timestamptz;
alter table public.transactions add column if not exists iso_currency_code text;
alter table public.transactions add column if not exists pending_external_id text;

create or replace function public.read_plaid_sync_token(p_user_id uuid, p_item_id text)
returns text language plpgsql security definer set search_path = '' as $$
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
end $$;
revoke all on function public.read_plaid_sync_token(uuid,text) from public,anon,authenticated;
grant execute on function public.read_plaid_sync_token(uuid,text) to service_role;

create or replace function public.apply_plaid_sync(
 p_user_id uuid,p_item_id text,p_expected_cursor text,p_next_cursor text,
 p_accounts jsonb,p_transactions jsonb,p_removed jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
end $$;
revoke all on function public.apply_plaid_sync(uuid,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_plaid_sync(uuid,text,text,text,jsonb,jsonb,jsonb) to service_role;
commit;
