select jsonb_build_object(
'public_tables_without_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity),
'unsafe_client_grants',(select count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')),
'orphan_private_token_rows',(select count(*) from public.plaid_private_tokens p where not exists(select 1 from public.bank_connections b where b.plaid_item_id=p.plaid_item_id and b.user_id=p.user_id)),
'disconnected_private_token_rows',(select count(*) from public.plaid_private_tokens p join public.bank_connections b on b.plaid_item_id=p.plaid_item_id and b.user_id=p.user_id where b.status='disconnected'),
'pending_private_token_rows',(select count(*) from public.plaid_private_tokens p join public.bank_connections b on b.plaid_item_id=p.plaid_item_id and b.user_id=p.user_id where b.status='disconnect_pending'),
'plaid_vault_entries_without_private_record',(select count(*) from vault.secrets s where s.name like 'plaid_%' and not exists(select 1 from public.plaid_private_tokens p where s.name='plaid_'||p.plaid_item_id)),
'connection_statuses',(select jsonb_object_agg(status,n) from (select coalesce(status,'null') status,count(*) n from public.bank_connections group by status) x),
'pending_migration_applied',exists(select 1 from information_schema.columns where table_schema='public' and table_name='bank_connections' and column_name='plaid_environment')
) as audit;
