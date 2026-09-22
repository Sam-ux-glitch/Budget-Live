import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {widgetSnapshot} from '../app/lib/widget.ts';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const cat='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const fixture=`create role anon; create role authenticated; create role service_role; create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
create table budget_categories(id uuid primary key default gen_random_uuid(),user_id uuid,name text,monthly_limit numeric,is_active boolean default true);
create table budget_months(id uuid primary key default gen_random_uuid(),user_id uuid,month date,category_id uuid,budget_amount numeric,unique(month,category_id));
create table budget_history(id uuid primary key default gen_random_uuid(),user_id uuid,category_id uuid,amount numeric,effective_date date,unique(user_id,category_id,effective_date));
create table settings(id integer primary key default 1, user_id uuid,savings_per_paycheck numeric,gas_minimum_amount numeric default 20,constraint single_settings_row check(id=1));
create table merchant_memory(id uuid primary key default gen_random_uuid(),user_id uuid,merchant_name text unique,category_id uuid,learned_from_user boolean,times_used int,updated_at timestamptz);
create table category_rules(id uuid primary key default gen_random_uuid(),user_id uuid,category_id uuid,match_text text,min_amount numeric,max_amount numeric,priority int default 100,is_active boolean default true,use_gas_minimum boolean default false,created_at timestamptz default now());
create table monthly_savings_overrides(user_id uuid,month date,savings_target_override numeric,primary key(user_id,month));
create table transactions(id uuid primary key default gen_random_uuid(),user_id uuid,category_id uuid,transaction_date date,merchant_name text,description text,amount numeric,plaid_category_detailed text,categorization_source text default 'uncategorized',user_category_confirmed boolean default false,is_transfer boolean default false,excluded_from_budget boolean default false,plaid_removed_at timestamptz,confidence numeric,needs_review boolean default false);
`;
async function database(){const db=new PGlite();await db.exec(fixture);for(const table of ['budget_categories','budget_months','budget_history','settings','transactions','merchant_memory','category_rules','monthly_savings_overrides'])await db.exec(`alter table ${table} enable row level security;create policy own on ${table} for all using(user_id=auth.uid()) with check(user_id=auth.uid());`);await db.exec(`insert into auth.users values ('${A}'),('${B}');insert into budget_categories(id,user_id,name,monthly_limit) values ('${cat}','${A}','Dining & Coffee',500),('${other}','${A}','Entertainment',200);`);await db.exec(readFileSync('supabase/migrations/202609200001_private_ios.sql','utf8'));await db.exec(`select set_config('request.jwt.claim.sub','${A}',false);select set_config('request.jwt.claim.role','authenticated',false);`);return db;}
async function proposal(db,actions){const r=await db.query("select create_coach_proposal(date_trunc('month',current_date)::date,$1::jsonb) p",[JSON.stringify(actions)]);return r.rows[0].p;}
const budgetAction={kind:'monthly_budget',category:'Dining & Coffee',amount:650};
test('database: monthly overrides, future defaults and historical snapshots',async()=>{const db=await database();try{
await db.exec("select create_month_budget(current_date);select create_month_budget((current_date+interval '1 month')::date);select set_month_budget(current_date,'Dining & Coffee',650);select set_default_budget('Dining & Coffee',550,(date_trunc('month',current_date)+interval '1 month')::date);");
const rows=(await db.query('select budget_amount,is_override from budget_months where category_id=$1 order by month',[cat])).rows;
assert.deepEqual(rows.map(r=>Number(r.budget_amount)),[650,550]);assert.deepEqual(rows.map(r=>r.is_override),[true,false]);
await assert.rejects(db.exec("select set_default_budget('Dining & Coffee',1,(current_date-interval '1 month')::date)"));
await db.exec("select create_month_budget((current_date-interval '1 month')::date)");assert.equal(Number((await db.query("select budget_amount from budget_months where category_id=$1 and month<date_trunc('month',current_date)",[cat])).rows[0].budget_amount),500);
}finally{await db.close();}});
test('database: no mutation before approval; reject, stale, replay, expiry and rollback',async()=>{const db=await database();try{
await db.exec('select create_month_budget(current_date)');let p=await proposal(db,[budgetAction]);
assert.equal(Number((await db.query('select budget_amount from budget_months where category_id=$1',[cat])).rows[0].budget_amount),500);
await db.query('select decide_coach_proposal($1,false)',[p.id]);assert.equal(Number((await db.query('select budget_amount from budget_months where category_id=$1',[cat])).rows[0].budget_amount),500);
p=await proposal(db,[budgetAction]);await db.exec("select set_month_budget(current_date,'Dining & Coffee',510)");await assert.rejects(db.query('select decide_coach_proposal($1,true)',[p.id]),/changed/);
p=await proposal(db,[budgetAction]);await db.query('select decide_coach_proposal($1,true)',[p.id]);await assert.rejects(db.query('select decide_coach_proposal($1,true)',[p.id]),/already/);
p=await proposal(db,[{kind:'reallocate',category:'Dining & Coffee',to_category:'Entertainment',amount:600},{kind:'reallocate',category:'Dining & Coffee',to_category:'Entertainment',amount:600}]);await assert.rejects(db.query('select decide_coach_proposal($1,true)',[p.id]));assert.equal(Number((await db.query('select budget_amount from budget_months where category_id=$1',[cat])).rows[0].budget_amount),650);
p=await proposal(db,[budgetAction]);await db.query("update coach_proposals set expires_at=now()-interval '1 second' where id=$1",[p.id]);await assert.rejects(db.query('select decide_coach_proposal($1,true)',[p.id]),/expired/);
}finally{await db.close();}});
test('database: owner isolation, rules amount boundaries and multi-user settings',async()=>{const db=await database();try{
await db.exec('select create_month_budget(current_date)');let p=await proposal(db,[budgetAction]);await db.exec(`select set_config('request.jwt.claim.sub','${B}',false)`);await assert.rejects(db.query('select decide_coach_proposal($1,true)',[p.id]));await assert.rejects(db.query('select apply_transaction_rules($1)',[A]),/Forbidden/);
await db.exec(`insert into settings(user_id) values ('${A}'),('${B}');select set_config('request.jwt.claim.sub','${A}',false);`);
await db.exec(`insert into transactions(user_id,transaction_date,amount,merchant_name,plaid_category_detailed) values ('${A}',current_date,19.99,'Station','TRANSPORTATION_GAS'),('${A}',current_date,20,'Station','TRANSPORTATION_GAS'),('${B}',current_date,5,'Station','TRANSPORTATION_GAS');`);
p=await proposal(db,[{kind:'rule',category:'Dining & Coffee',match_text:'GAS',match_field:'plaid_category',max_amount:19.99}]);await db.query('select decide_coach_proposal($1,true)',[p.id]);const rows=(await db.query('select amount,category_id,user_id from transactions order by amount')).rows;assert.equal(rows[0].category_id,null);assert.equal(rows[1].category_id,cat);assert.equal(rows[2].category_id,null);
await assert.rejects(db.exec(`insert into transactions(user_id,category_id) values ('${B}','${cat}')`),/belong/);
await db.exec('grant usage on schema public,auth to authenticated;grant select on all tables in schema public to authenticated;set role authenticated;');await db.exec(`select set_config('request.jwt.claim.sub','${B}',false)`);assert.equal((await db.query('select * from coach_proposals')).rows.length,0);assert.equal((await db.query('select * from budget_categories')).rows.length,0);assert.equal((await db.query('select * from transactions where user_id=$1',[A])).rows.length,0);
}finally{await db.close();}});
test('database: Plaid disconnect blocks token reads and in-flight sync, reconnect is separate',async()=>{const db=await database();try{
await db.exec(`create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);create table bank_connections(id uuid primary key,user_id uuid,plaid_item_id text,institution_name text,status text,last_synced_at timestamptz);create table plaid_private_tokens(user_id uuid,plaid_item_id text,sync_cursor text,updated_at timestamptz);insert into bank_connections values ('20000000-0000-4000-8000-000000000001','${A}','item',null,'active',null);insert into plaid_private_tokens values ('${A}','item',null,null);insert into vault.decrypted_secrets values ('plaid_item','synthetic-token');`);
const sync=readFileSync('supabase/migrations/202609190001_plaid_sync.sql','utf8');await db.exec(sync.slice(sync.indexOf('create or replace function public.read_plaid_sync_token'),sync.lastIndexOf('commit;')));
await db.exec(readFileSync('supabase/migrations/202609200002_plaid_disconnect.sql','utf8'));
const connection='20000000-0000-4000-8000-000000000001';
await db.exec('set role authenticated');await assert.rejects(db.query('select begin_plaid_disconnect($1,$2)',[A,connection]),/permission/);await db.exec('reset role');
await assert.rejects(db.query('select begin_plaid_disconnect($1,$2)',[B,connection]));assert.equal((await db.query('select read_plaid_sync_token($1,$2) token',[A,'item'])).rows[0].token,'synthetic-token');
await db.query('select begin_plaid_disconnect($1,$2)',[A,connection]);await assert.rejects(db.query('select read_plaid_sync_token($1,$2)',[A,'item']),/Active connection/);
await assert.rejects(db.query("select apply_plaid_sync($1,$2,null,'next','[]','[]','[]')",[A,'item']),/Active connection/);
await db.query('select finish_plaid_disconnect($1,$2)',[A,connection]);assert.equal((await db.query('select status from bank_connections')).rows[0].status,'disconnected');
await db.exec(`insert into bank_connections values ('20000000-0000-4000-8000-000000000002','${A}','new-item',null,'active',null);insert into plaid_private_tokens values ('${A}','new-item',null,null);insert into vault.decrypted_secrets values ('plaid_new-item','new-synthetic-token');`);assert.equal((await db.query('select read_plaid_sync_token($1,$2) token',[A,'new-item'])).rows[0].token,'new-synthetic-token');
}finally{await db.close();}});
test('widget: remaining, percentage, over-budget, refunds and month expiry',()=>{const cats=[{id:'a',name:'Gas',monthly_limit:500,category_type:'flexible'}];const tx=[{id:'t',category_id:'a',amount:350,transaction_date:'2026-09-01'}];const date=new Date(2026,8,20);const snap=widgetSnapshot(cats,tx,'2026-09',['Gas'],date);assert.equal(snap.categories[0].remaining,150);assert.equal(snap.categories[0].progress,0.3);assert.equal(widgetSnapshot(cats,[{...tx[0],amount:600}],'2026-09',['Gas'],date).categories[0].progress,0);assert.equal(widgetSnapshot(cats,[{...tx[0],amount:-20}],'2026-09',['Gas'],date).categories[0].progress,1);assert.throws(()=>widgetSnapshot(cats,tx,'2026-08',['Gas'],date));assert.deepEqual(widgetSnapshot(cats,tx,'2026-09',[],date).categories,[]);});
