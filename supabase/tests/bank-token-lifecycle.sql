-- Run after the bank security migration. Synthetic tokens only; always rolls back.
begin;
do $$ declare owner_id uuid; connection uuid; state jsonb; other_id uuid:='00000000-0000-4000-8000-000000000099';begin
select id into owner_id from auth.users limit 1;
perform public.register_plaid_connection(owner_id,'budget-security-test-item','synthetic-not-a-plaid-token','sandbox');
select id into connection from public.bank_connections where plaid_item_id='budget-security-test-item';
if public.read_plaid_sync_token(owner_id,'budget-security-test-item')<>'synthetic-not-a-plaid-token' then raise exception 'Token storage failed';end if;
begin perform public.register_plaid_connection(other_id,'budget-security-test-item','wrong-owner','sandbox');raise exception 'Ownership test failed';exception when raise_exception then if sqlerrm<>'Connection ownership conflict' then raise;end if;end;
state:=public.begin_plaid_disconnect(owner_id,connection);
if state->>'environment'<>'sandbox' then raise exception 'Environment missing';end if;
begin perform public.read_plaid_sync_token(owner_id,'budget-security-test-item');raise exception 'Pause test failed';exception when raise_exception then if sqlerrm not like 'Active connection%' then raise;end if;end;
perform public.finish_plaid_disconnect(owner_id,connection);
if exists(select 1 from public.plaid_private_tokens where plaid_item_id='budget-security-test-item') or exists(select 1 from vault.secrets where name='plaid_budget-security-test-item') then raise exception 'Revoked token retained';end if;
perform public.register_plaid_connection(owner_id,'budget-security-reconnect','synthetic-reconnect','sandbox');
if public.read_plaid_sync_token(owner_id,'budget-security-reconnect')<>'synthetic-reconnect' then raise exception 'Reconnect failed';end if;
end $$;
select 'PASS: atomic registration, ownership rejection, paused reads, private/Vault cleanup, separate reconnect' as result;
rollback;