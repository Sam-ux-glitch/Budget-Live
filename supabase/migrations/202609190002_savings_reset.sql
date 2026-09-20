-- The existing savings table, SELECT/INSERT/UPDATE policies and unique
-- (user_id, month) constraint are prerequisites from Savings V1.
-- Reset removes only the signed-in owner's monthly override.
-- No default values, financial rows, or existing policies are changed.
begin;
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'monthly_savings_overrides' and c.relrowsecurity
  ) then
    raise exception 'Savings V1 table with row-level security must exist before this migration';
  end if;
end $$;
grant delete on public.monthly_savings_overrides to authenticated;
drop policy if exists savings_v2_delete_own_override on public.monthly_savings_overrides;
create policy savings_v2_delete_own_override
  on public.monthly_savings_overrides for delete to authenticated
  using ((select auth.uid()) = user_id);
commit;
