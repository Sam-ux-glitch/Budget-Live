begin;
create temporary table isolation_results(object_name text,check_name text,result text);
do $$ declare target uuid; t record; n bigint; baseline bigint; begin
select user_id into target from public.budget_categories limit 1;
if target is null then raise exception 'No owner fixture';end if;
perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
perform set_config('request.jwt.claim.role','authenticated',true);
for t in select c.table_name from information_schema.columns c where c.table_schema='public' and c.column_name='user_id' loop
 execute format('select count(*) from public.%I where user_id=$1',t.table_name) into baseline using target;
 execute 'set local role authenticated';
 begin execute format('select count(*) from public.%I where user_id=$1',t.table_name) into n using target;if n<>0 then raise exception 'Cross-owner read on %',t.table_name;end if;
 exception when insufficient_privilege then n:=0;end;
 execute 'reset role';
 insert into isolation_results values(t.table_name,'foreign read','PASS (owner rows: '||baseline||')');
 if exists(select 1 from information_schema.tables where table_schema='public' and table_name=t.table_name and table_type='BASE TABLE') then
 execute 'set local role authenticated';
 begin execute format('update public.%I set user_id=user_id where user_id=$1',t.table_name) using target;get diagnostics n=row_count;if n<>0 then raise exception 'Cross-owner update on %',t.table_name;end if;exception when insufficient_privilege then null;end;
 begin execute format('delete from public.%I where user_id=$1',t.table_name) using target;get diagnostics n=row_count;if n<>0 then raise exception 'Cross-owner delete on %',t.table_name;end if;exception when insufficient_privilege then null;end;
 execute 'reset role';insert into isolation_results values(t.table_name,'foreign update/delete','PASS');
 end if;
end loop;
for t in select p.oid::regprocedure::text name from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname in ('begin_plaid_disconnect','finish_plaid_disconnect','read_plaid_sync_token','store_plaid_token_in_vault','apply_plaid_sync','register_plaid_connection') loop
 if has_function_privilege('authenticated',t.name,'EXECUTE') or has_function_privilege('anon',t.name,'EXECUTE') then raise exception 'Exposed token function %',t.name;end if;
 insert into isolation_results values(t.name,'client execution denied','PASS');
end loop;
end $$;
select jsonb_agg(to_jsonb(r)) as isolation_results from isolation_results r;
rollback;