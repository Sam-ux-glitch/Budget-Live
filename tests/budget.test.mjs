import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBudget, fetchAllPages, monthBounds, currentMonth } from '../app/lib/budget.ts';
const categories = [
  { id: 'food', name: 'Food', monthly_limit: '100.00', category_type: 'variable' },
  { id: 'travel', name: 'Travel', monthly_limit: 50, category_type: 'variable' },
];
const row = (changes = {}) => ({ id: 't', category_id: 'food', transaction_date: '2026-09-19', amount: 25,
  excluded_from_budget: false, is_transfer: false, plaid_removed_at: null, ...changes });
test('purchases and negative refunds affect only their category, without clamping credits', () => {
  const result = summarizeBudget(categories, [row({amount: 60}), row({amount: -15}), row({category_id:'travel',amount:-20})], '2026-09');
  assert.deepEqual(result.rows.map(r=>[r.spent,r.remaining]), [[45,55],[-20,70]]);
  assert.equal(result.spent,25); assert.equal(result.remaining,125);
});
test('excluded payments, transfers, income and removed transactions never count', () => {
  const result = summarizeBudget(categories, [row(), row({excluded_from_budget:true,amount:1000}),
    row({is_transfer:true,amount:-500}), row({plaid_removed_at:'2026-09-20',amount:300})], '2026-09');
  assert.equal(result.spent,25);
});
test('month boundaries include first and last day but exclude surrounding months', () => {
  const result = summarizeBudget(categories, ['2026-08-31','2026-09-01','2026-09-30','2026-10-01'].map(transaction_date=>row({transaction_date})), '2026-09');
  assert.equal(result.spent,50);
  assert.deepEqual(monthBounds('2026-12'),{start:'2026-12-01',end:'2027-01-01'});
  assert.deepEqual(monthBounds('2024-02'),{start:'2024-02-01',end:'2024-03-01'});
  assert.equal(currentMonth(new Date(2026,0,1)), '2026-01');
  assert.throws(()=>monthBounds('2026-13'));
});
test('missing and inactive categories remain visible separately and zero-spend categories remain', () => {
  const result = summarizeBudget(categories,[row({category_id:null}),row({category_id:'inactive',amount:-5})],'2026-09');
  assert.equal(result.unassigned,20); assert.equal(result.unassignedCount,2);
  assert.equal(result.spent,0); assert.equal(result.remaining,150); assert.equal(result.rows.length,2);
});
test('overspending and decimal money retain exact cents', () => {
  const result = summarizeBudget(categories,[row({amount:'100.10'}),row({amount:'0.20'})],'2026-09');
  assert.equal(result.rows[0].spent,100.30); assert.equal(result.rows[0].remaining,-0.30);
  assert.throws(()=>summarizeBudget(categories,[row({amount:'invalid'})],'2026-09'));
});
test('all pages contribute beyond both the 100 recent limit and 1000 API limit', async () => {
  const source = Array.from({length:1207},(_,i)=>row({id:String(i),amount:1}));
  const ranges=[];
  const result=await fetchAllPages(async(from,to)=>{ranges.push([from,to]);return {data:source.slice(from,Math.min(to+1,from+137)),error:null};});
  assert.equal(result.length,1207); assert.equal(summarizeBudget(categories,result,'2026-09').spent,1207);
  assert.equal(ranges[1][0],137);
});
test('later page failure rejects instead of returning plausible partial spending', async () => {
  await assert.rejects(fetchAllPages(async from=>from===0?{data:[row()],error:null}:{data:null,error:{message:'network failure'}}),/network failure/);
  assert.deepEqual(await fetchAllPages(async()=>({data:[],error:null})),[]);
});
