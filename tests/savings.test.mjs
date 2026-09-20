import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSavingsPlan, parseSavingsTarget } from '../app/lib/savings.ts';
import { summarizeBudget } from '../app/lib/budget.ts';
const inputs = {month:'2026-09',expectedIncome:5000,paycheckCount:2,savingsPerPaycheck:600,monthlyOverride:null};
const budget = summarizeBudget([{id:'food',name:'Food',monthly_limit:1800,category_type:'variable'}], [], '2026-09');
test('automatic target uses saved per-paycheck amount and zero/two/three paychecks', () => {
  for (const count of [0,2,3]) assert.equal(buildSavingsPlan({...inputs,paycheckCount:count},budget).target,600*count);
  const plan=buildSavingsPlan(inputs,budget);
  assert.equal(plan.projectedSurplus,3200); assert.equal(plan.headroom,2000); assert.equal(plan.status,'supported');
});
test('override preserves automatic target and default; zero is a real override; reset follows default', () => {
  const plan=buildSavingsPlan({...inputs,monthlyOverride:4000},budget);
  assert.equal(plan.automaticTarget,1200); assert.equal(plan.target,4000); assert.equal(plan.shortfall,800);
  assert.equal(plan.targetSource,'monthly_override'); assert.equal(plan.status,'shortfall');
  assert.equal(buildSavingsPlan({...inputs,monthlyOverride:0},budget).target,0);
  assert.equal(buildSavingsPlan({...inputs,savingsPerPaycheck:700},budget).target,1400);
  assert.equal(inputs.savingsPerPaycheck,600);
});
test('exact support, negative surplus and currency decimals are handled in cents', () => {
  assert.equal(buildSavingsPlan({...inputs,monthlyOverride:3200},budget).shortfall,0);
  const deficit=buildSavingsPlan({...inputs,expectedIncome:1000,monthlyOverride:100},budget);
  assert.equal(deficit.projectedSurplus,-800); assert.equal(deficit.shortfall,900);
  assert.equal(buildSavingsPlan({...inputs,savingsPerPaycheck:'0.10',paycheckCount:3},budget).target,0.3);
});
test('missing income or setting is unavailable, never an invented savings amount', () => {
  assert.equal(buildSavingsPlan({...inputs,savingsPerPaycheck:null},budget).target,null);
  assert.equal(buildSavingsPlan({...inputs,savingsPerPaycheck:null,monthlyOverride:100},budget).target,100);
  assert.equal(buildSavingsPlan({...inputs,expectedIncome:null},budget).status,'unavailable');
  assert.equal(buildSavingsPlan({...inputs,savingsPerPaycheck:0},budget).target,0);
});
test('validation rejects blank, negative, non-finite, unsafe and fractional-cent input', () => {
  for (const value of ['', ' ', '-1', 'NaN', 'Infinity', '1.001','1e3','9007199254740992']) assert.throws(()=>parseSavingsTarget(value));
  assert.equal(parseSavingsTarget('0'),0); assert.equal(parseSavingsTarget(' 123.45 '),123.45);
  assert.throws(()=>buildSavingsPlan({...inputs,paycheckCount:1.5},budget));
});
test('coach facts expose over/under budget and unassigned expenses without double subtracting actuals', () => {
  const tx=(id,category_id,amount)=>({id,category_id,amount,transaction_date:'2026-09-19',excluded_from_budget:false,is_transfer:false,plaid_removed_at:null});
  const summary=summarizeBudget([{id:'food',name:'Food',monthly_limit:100,category_type:'variable'}],[tx('1','food',150),tx('2',null,80)],'2026-09');
  const plan=buildSavingsPlan(inputs,summary);
  assert.equal(plan.categoryOverspending,50); assert.equal(plan.unassignedSpending,80);
  assert.equal(plan.categories[0].remaining,-50); assert.equal(plan.projectedSurplus,4900);
  assert.equal(JSON.parse(JSON.stringify(plan)).schemaVersion,1);
});
