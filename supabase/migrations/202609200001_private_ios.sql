-- Existing Budget Live schema prerequisite; transactional, no secret values.
begin;
-- Remove legacy global uniqueness while retaining every user's settings/history.
alter table public.settings drop constraint if exists single_settings_row;
alter table public.settings drop constraint if exists settings_pkey;
alter table public.settings alter column user_id set not null;
alter table public.settings add primary key (user_id);
alter table public.merchant_memory drop constraint if exists merchant_memory_merchant_name_key;
create unique index if not exists merchant_memory_owner_merchant on public.merchant_memory(user_id,merchant_name);
alter table public.budget_months add column if not exists is_override boolean not null default true;
-- Preserve historical snapshots. Existing current/future rows matching the baseline are automatic.
update public.budget_months m set is_override=false from public.budget_categories c where m.category_id=c.id and m.user_id=c.user_id and m.month>=date_trunc('month',current_date)::date and m.budget_amount=c.monthly_limit;
insert into public.budget_history(user_id,category_id,amount,effective_date)
select user_id,id,monthly_limit,date '1900-01-01' from public.budget_categories
on conflict (user_id,category_id,effective_date) do nothing;
create or replace function public.create_month_budget(target_month date) returns void language plpgsql set search_path=public as $$
declare m date:=date_trunc('month',target_month)::date;
begin
 if auth.uid() is null or m is null then raise exception 'Sign in and choose a month'; end if;
 insert into public.budget_months(user_id,month,category_id,budget_amount,is_override)
 select auth.uid(),m,c.id,coalesce((select h.amount from public.budget_history h where h.user_id=auth.uid() and h.category_id=c.id and h.effective_date<=m order by h.effective_date desc limit 1),c.monthly_limit),false
 from public.budget_categories c where c.user_id=auth.uid() and c.is_active
 on conflict(month,category_id) do update set budget_amount=excluded.budget_amount
 where budget_months.user_id=auth.uid() and not budget_months.is_override and budget_months.month>=date_trunc('month',current_date)::date;
end $$;
create or replace function public.set_month_budget(target_month date,target_category text,new_amount numeric) returns void language plpgsql set search_path=public as $$
declare c uuid;
begin
 if new_amount is null or new_amount<0 or new_amount>1000000 or new_amount<>round(new_amount,2) or target_month is null then raise exception 'Invalid budget amount/month'; end if;
 select id into strict c from public.budget_categories where user_id=auth.uid() and lower(name)=lower(target_category) and is_active;
 insert into public.budget_months(user_id,month,category_id,budget_amount,is_override) values(auth.uid(),date_trunc('month',target_month)::date,c,new_amount,true)
 on conflict(month,category_id) do update set budget_amount=excluded.budget_amount,is_override=true where budget_months.user_id=auth.uid();
end $$;
create or replace function public.set_default_budget(target_category text,new_amount numeric,effective_date date default current_date) returns void language plpgsql set search_path=public as $$
declare c uuid; m date:=date_trunc('month',effective_date)::date;
begin
 if new_amount is null or new_amount<0 or new_amount>1000000 or new_amount<>round(new_amount,2) or m is null or m<(date_trunc('month',current_date)+interval '1 month')::date then raise exception 'Default must start next month or later'; end if;
 select id into strict c from public.budget_categories where user_id=auth.uid() and lower(name)=lower(target_category) and is_active;
 insert into public.budget_history(user_id,category_id,amount,effective_date) values(auth.uid(),c,new_amount,m) on conflict on constraint budget_history_user_id_category_id_effective_date_key do update set amount=excluded.amount;
 update public.budget_categories set monthly_limit=new_amount where id=c and user_id=auth.uid();
 update public.budget_months b set budget_amount=(select h.amount from public.budget_history h where h.user_id=auth.uid() and h.category_id=c and h.effective_date<=b.month order by h.effective_date desc limit 1) where b.user_id=auth.uid() and b.category_id=c and b.month>=m and not b.is_override;
end $$;
-- Remove the ambiguous legacy overload; no destructive data operation.
drop function if exists public.set_default_budget(text,numeric);
alter table public.category_rules add column if not exists match_field text not null default 'merchant';
alter table public.category_rules add column if not exists effective_from date;
create or replace function public.apply_transaction_rules(target_user_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is distinct from target_user_id and coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden'; end if;
 update public.transactions t set category_id=m.category_id,categorization_source='merchant_memory',confidence=1,needs_review=false
 from public.merchant_memory m join public.budget_categories c on c.id=m.category_id and c.user_id=m.user_id
 where t.user_id=target_user_id and m.user_id=target_user_id and lower(trim(t.merchant_name))=lower(trim(m.merchant_name)) and not t.user_category_confirmed and not t.is_transfer and not t.excluded_from_budget and t.plaid_removed_at is null;
 -- One deterministic highest-priority match. Specific approved rules override merchant memory.
 with matches as (select t.id,(select r.category_id from public.category_rules r join public.budget_categories c on c.id=r.category_id and c.user_id=r.user_id and c.is_active where r.user_id=target_user_id and r.is_active
 and (r.effective_from is null or t.transaction_date>=r.effective_from)
 and (case when r.match_field='plaid_category' then strpos(lower(coalesce(t.plaid_category_detailed,'')),lower(r.match_text))>0 else strpos(lower(coalesce(t.merchant_name,'')||' '||coalesce(t.description,'')),lower(r.match_text))>0 end)
 and (r.min_amount is null or t.amount>=r.min_amount) and (r.max_amount is null or t.amount<=r.max_amount)
 and (not r.use_gas_minimum or t.amount>=coalesce((select gas_minimum_amount from public.settings where user_id=target_user_id),20))
 and (t.categorization_source<>'merchant_memory' or r.priority<100)
 order by r.priority,r.created_at desc,r.id limit 1) as category
 from public.transactions t where t.user_id=target_user_id and not t.user_category_confirmed and not t.is_transfer and not t.excluded_from_budget and t.plaid_removed_at is null)
 update public.transactions t set category_id=m.category,categorization_source='rule',confidence=1,needs_review=false from matches m where t.id=m.id and t.user_id=target_user_id and m.category is not null;
end $$;
revoke all on function public.apply_transaction_rules(uuid) from public,anon;
grant execute on function public.apply_transaction_rules(uuid) to authenticated,service_role;
create or replace function public.confirm_transaction_category(target_transaction uuid,target_category uuid) returns void language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from public.budget_categories where id=target_category and user_id=auth.uid() and is_active) then raise exception 'Invalid category';end if;
 update public.transactions set category_id=target_category,categorization_source='user',user_category_confirmed=true,needs_review=false where id=target_transaction and user_id=auth.uid();
 if not found then raise exception 'Transaction not found';end if;
end $$;
create or replace function public.remember_merchant_category(target_transaction uuid,target_category uuid) returns void language plpgsql set search_path=public as $$
declare merchant text;
begin
 if not exists(select 1 from public.budget_categories where id=target_category and user_id=auth.uid() and is_active) then raise exception 'Invalid category';end if;
 select merchant_name into strict merchant from public.transactions where id=target_transaction and user_id=auth.uid();
 if merchant is null then raise exception 'Merchant unavailable';end if;
 insert into public.merchant_memory(user_id,merchant_name,category_id,learned_from_user,times_used) values(auth.uid(),merchant,target_category,true,1)
 on conflict(user_id,merchant_name) do update set category_id=excluded.category_id,learned_from_user=true,times_used=merchant_memory.times_used+1,updated_at=now();
end $$;
-- Serialize approved changes with ordinary app edits/sync, and validate cross-owner references.
create or replace function public.guard_financial_write() returns trigger language plpgsql set search_path=public as $$
declare owner_id uuid; cat uuid;
begin
 owner_id:=case when TG_OP='DELETE' then OLD.user_id else NEW.user_id end;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 if TG_OP<>'DELETE' and TG_TABLE_NAME in ('transactions','budget_months','budget_history','merchant_memory','category_rules') then
  cat:=NEW.category_id;
  if cat is not null and not exists(select 1 from public.budget_categories where id=cat and user_id=owner_id) then raise exception 'Category does not belong to this user';end if;
 end if;
 if TG_OP='DELETE' then return OLD;else return NEW;end if;
end $$;
do $$ declare t text;begin foreach t in array array['budget_categories','budget_months','budget_history','monthly_savings_overrides','transactions','category_rules','merchant_memory','settings'] loop
 execute format('create trigger financial_write_guard before insert or update or delete on public.%I for each row execute function public.guard_financial_write()',t);
end loop;end $$;
create table public.coach_proposals(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),month date not null,actions jsonb not null,before_values jsonb not null,revision text not null,status text not null default 'pending' check(status in ('pending','approved','rejected')),expires_at timestamptz not null default(now()+interval '10 minutes'),created_at timestamptz not null default now());
alter table public.coach_proposals enable row level security;
create policy owner_read on public.coach_proposals for select to authenticated using(user_id=auth.uid());
revoke all on public.coach_proposals from anon,authenticated;
grant select on public.coach_proposals to authenticated;
create or replace function public.coach_revision(m date) returns text language sql stable security invoker set search_path=public as $$
 select md5(jsonb_build_array(
 (select jsonb_agg(to_jsonb(c) order by c.id) from budget_categories c where user_id=auth.uid()),
 (select jsonb_agg(to_jsonb(b) order by b.id) from budget_months b where user_id=auth.uid()),
 (select jsonb_agg(to_jsonb(h) order by h.id) from budget_history h where user_id=auth.uid()),
 (select jsonb_agg(to_jsonb(s)) from monthly_savings_overrides s where user_id=auth.uid() and month=m),
 (select jsonb_agg(to_jsonb(s)) from settings s where user_id=auth.uid()),
 (select jsonb_agg(to_jsonb(t) order by t.id) from transactions t where user_id=auth.uid() and transaction_date>=m and transaction_date<(m+interval '1 month')),
 (select jsonb_agg(to_jsonb(r) order by r.id) from category_rules r where user_id=auth.uid()),
 (select jsonb_agg(to_jsonb(r) order by r.id) from merchant_memory r where user_id=auth.uid())
 )::text)
$$;
create or replace function public.create_coach_proposal(p_month date,p_actions jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a jsonb; b jsonb:='[]'; c uuid; dest uuid; amount numeric; old_amount numeric; k text; result public.coach_proposals; n integer;
begin
 if auth.uid() is null or p_month is null or p_month<>date_trunc('month',p_month)::date or jsonb_typeof(p_actions)<>'array' or jsonb_array_length(p_actions) not between 1 and 5 then raise exception 'Invalid proposal';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select count(*) into n from coach_proposals where user_id=auth.uid() and created_at>now()-interval '1 minute';if n>=10 then raise exception 'Too many proposals';end if;
 for a in select value from jsonb_array_elements(p_actions) loop
  k:=a->>'kind';amount:=(a->>'amount')::numeric;c:=null;dest:=null;
  if k not in ('monthly_budget','reallocate','default_budget','savings','savings_reset','categorize','rule') or k is null then raise exception 'Unsupported action';end if;
  if k in ('monthly_budget','reallocate','default_budget','savings') and (amount is null or amount<0 or amount>1000000 or amount<>round(amount,2)) then raise exception 'Invalid amount';end if;
  if k in ('monthly_budget','reallocate','default_budget','categorize','rule') then
   select id into strict c from budget_categories where user_id=auth.uid() and is_active and lower(name)=lower(a->>'category');
  end if;
  if k in ('monthly_budget','reallocate') then
   select budget_amount into old_amount from budget_months where user_id=auth.uid() and month=p_month and category_id=c;
   if old_amount is null then raise exception 'Open this month in Budget first';end if;
   if k='reallocate' then
    select id into strict dest from budget_categories where user_id=auth.uid() and is_active and lower(name)=lower(a->>'to_category');
    if dest=c or amount<=0 or old_amount<amount or not exists(select 1 from budget_months where user_id=auth.uid() and month=p_month and category_id=dest) then raise exception 'Invalid reallocation';end if;
   end if;
  elsif k='default_budget' then select monthly_limit into old_amount from budget_categories where user_id=auth.uid() and id=c;
  elsif k in ('savings','savings_reset') then select savings_target_override into old_amount from monthly_savings_overrides where user_id=auth.uid() and month=p_month;
  elsif k='categorize' then
   if not exists(select 1 from transactions where user_id=auth.uid() and id=(a->>'transaction_id')::uuid and transaction_date>=p_month and transaction_date<p_month+interval '1 month') then raise exception 'Transaction unavailable';end if;
  elsif k='rule' then
   if length(trim(coalesce(a->>'match_text',''))) not between 2 and 100 or coalesce(a->>'match_field','') not in ('merchant','plaid_category') then raise exception 'Invalid rule';end if;
   if (a->>'max_amount') is not null and ((a->>'max_amount')::numeric<0 or (a->>'max_amount')::numeric>1000000 or (a->>'max_amount')::numeric<>round((a->>'max_amount')::numeric,2)) then raise exception 'Invalid rule maximum';end if;
  end if;
  b:=b||jsonb_build_array(jsonb_build_object('kind',k,'category',a->>'category','previous_amount',old_amount,'destination_previous_amount',(select budget_amount from budget_months where user_id=auth.uid() and month=p_month and category_id=dest),'default_starts',(date_trunc('month',current_date)+interval '1 month')::date,'rule_starts',current_date));old_amount:=null;
 end loop;
 insert into coach_proposals(user_id,month,actions,before_values,revision) values(auth.uid(),p_month,p_actions,b,coach_revision(p_month)) returning * into result;
 return to_jsonb(result)-'user_id'-'revision';
end $$;
create or replace function public.decide_coach_proposal(proposal_id uuid,approve boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare p coach_proposals; a jsonb; c uuid; old_amount numeric; dest_amount numeric;
begin
 if auth.uid() is null or approve is null then raise exception 'Sign in';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into strict p from coach_proposals where id=proposal_id and user_id=auth.uid() for update;
 if p.status<>'pending' then raise exception 'Proposal already decided';end if;
 if not approve then update coach_proposals set status='rejected' where id=p.id;return jsonb_build_object('status','rejected');end if;
 if p.expires_at<now() or p.revision<>coach_revision(p.month) then raise exception 'Proposal expired or budget changed. Ask for a fresh proposal.' using errcode='40001';end if;
 for a in select value from jsonb_array_elements(p.actions) loop
  if a->>'kind'='monthly_budget' then perform set_month_budget(p.month,a->>'category',(a->>'amount')::numeric);
  elsif a->>'kind'='default_budget' then perform set_default_budget(a->>'category',(a->>'amount')::numeric,(date_trunc('month',current_date)+interval '1 month')::date);
  elsif a->>'kind'='reallocate' then
   select b.budget_amount into strict old_amount from budget_months b join budget_categories c on c.id=b.category_id where b.user_id=auth.uid() and c.user_id=auth.uid() and b.month=p.month and lower(c.name)=lower(a->>'category');
   select b.budget_amount into strict dest_amount from budget_months b join budget_categories c on c.id=b.category_id where b.user_id=auth.uid() and c.user_id=auth.uid() and b.month=p.month and lower(c.name)=lower(a->>'to_category');
   perform set_month_budget(p.month,a->>'category',old_amount-(a->>'amount')::numeric);perform set_month_budget(p.month,a->>'to_category',dest_amount+(a->>'amount')::numeric);
  elsif a->>'kind'='savings' then insert into monthly_savings_overrides(user_id,month,savings_target_override) values(auth.uid(),p.month,(a->>'amount')::numeric) on conflict(user_id,month) do update set savings_target_override=excluded.savings_target_override;
  elsif a->>'kind'='savings_reset' then delete from monthly_savings_overrides where user_id=auth.uid() and month=p.month;
  elsif a->>'kind'='categorize' then select id into strict c from budget_categories where user_id=auth.uid() and lower(name)=lower(a->>'category') and is_active;perform confirm_transaction_category((a->>'transaction_id')::uuid,c);
  elsif a->>'kind'='rule' then
   select id into strict c from budget_categories where user_id=auth.uid() and lower(name)=lower(a->>'category') and is_active;
   insert into category_rules(user_id,category_id,match_text,match_field,min_amount,max_amount,priority,effective_from) values(auth.uid(),c,trim(a->>'match_text'),a->>'match_field',0,(a->>'max_amount')::numeric,10,current_date);
   perform apply_transaction_rules(auth.uid());
  end if;
 end loop;
 update coach_proposals set status='approved' where id=p.id;
 return jsonb_build_object('status','approved');
end $$;
revoke all on function public.create_coach_proposal(date,jsonb),public.decide_coach_proposal(uuid,boolean) from public,anon;
grant execute on function public.create_coach_proposal(date,jsonb),public.decide_coach_proposal(uuid,boolean) to authenticated;
create or replace function public.apply_ai_category(target_transaction uuid,target_category uuid,ai_confidence numeric,ai_reasoning text,ai_model text) returns void language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from budget_categories where id=target_category and user_id=auth.uid() and is_active) then raise exception 'Invalid category';end if;
 if ai_confidence is null or ai_confidence<0 or ai_confidence>1 then raise exception 'Invalid confidence';end if;
 update transactions set category_id=target_category,confidence=ai_confidence,categorization_source='ai',ai_status='completed',ai_processed_at=now(),needs_review=false
 where id=target_transaction and user_id=auth.uid() and not user_category_confirmed and category_id is null and not is_transfer and not excluded_from_budget and plaid_removed_at is null;
 if not found then return;end if;
 insert into ai_categorizations(user_id,transaction_id,category_id,confidence,reasoning,model_used) values(auth.uid(),target_transaction,target_category,ai_confidence,left(ai_reasoning,500),ai_model);
end $$;
commit;
