-- Sandbox maintenance only, AFTER 202609210001_bank_security.sql.
-- Review first. This restores missing connection metadata in PAUSED state;
-- it does NOT revoke tokens and never prints them. Then use Accounts > Disconnect
-- for each recovered connection. Do not delete private/Vault records first.
begin;
do $$ begin
 if exists(select 1 from public.plaid_private_tokens p
 where not exists(select 1 from public.bank_connections b where b.plaid_item_id=p.plaid_item_id and b.user_id=p.user_id)
 and not exists(select 1 from vault.decrypted_secrets s where s.name='plaid_'||p.plaid_item_id and s.decrypted_secret like 'access-sandbox-%')) then
 raise exception 'Orphan token missing or not sandbox; stop for server-side investigation';end if;
end $$;
insert into public.bank_connections(user_id,plaid_item_id,status,plaid_environment)
select p.user_id,p.plaid_item_id,'disconnect_pending','sandbox' from public.plaid_private_tokens p
where not exists(select 1 from public.bank_connections b where b.plaid_item_id=p.plaid_item_id)
on conflict(plaid_item_id) do nothing;
commit;
