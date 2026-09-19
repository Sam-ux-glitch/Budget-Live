import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { collectSync, normalizeTransaction, SyncError } from './core.ts';
const transaction=(id='t1',detailed='FOOD_AND_DRINK_RESTAURANT',primary='FOOD_AND_DRINK')=>({
 transaction_id:id,account_id:'a1',date:'2026-09-19',amount:25,pending:false,name:'Fixture',
 iso_currency_code:'USD',personal_finance_category:{primary,detailed}});
const page=(cursor='c1')=>({added:[],modified:[],removed:[],accounts:[],next_cursor:cursor,has_more:false});
test('credit card payments and own-account transfers do not count as spending',()=>{
 for(const detailed of ['LOAN_PAYMENTS_CREDIT_CARD_PAYMENT','TRANSFER_IN_ACCOUNT_TRANSFER','TRANSFER_OUT_ACCOUNT_TRANSFER']) {
  const row=normalizeTransaction(transaction('t',detailed)); assert.equal(row.is_transfer,true); assert.equal(row.excluded_from_budget,true);
 }
 assert.equal(normalizeTransaction(transaction()).excluded_from_budget,false);
});
test('refunds preserve their negative amount; income excluded; ambiguous transfers reviewed',()=>{
 assert.equal(normalizeTransaction({...transaction(),amount:-25}).amount,-25);
 assert.equal(normalizeTransaction({...transaction(),amount:-25}).excluded_from_budget,false);
 assert.equal(normalizeTransaction(transaction('t','INCOME_WAGES','INCOME')).excluded_from_budget,true);
 const ambiguous=normalizeTransaction(transaction('t','TRANSFER_OUT_OTHER_TRANSFER_OUT','TRANSFER_OUT'));
 assert.equal(ambiguous.is_transfer,false); assert.equal(ambiguous.needs_review,true);
 assert.equal(normalizeTransaction({...transaction(),iso_currency_code:'EUR'}).excluded_from_budget,true);
});
test('pagination merges modifications and removals before persistence',async()=>{
 const cursors=[]; const result=await collectSync(null,async cursor=>{cursors.push(cursor);
  return cursor===null?{...page('c1'),added:[transaction()],has_more:true}:
    {...page('c2'),modified:[{...transaction(),amount:40}],added:[transaction('t2')],removed:[{transaction_id:'t2'}]};
 });
 assert.deepEqual(cursors,[null,'c1']); assert.equal(result.transactions.length,1);
 assert.equal(result.transactions[0].amount,40); assert.deepEqual(result.removed,['t2']); assert.equal(result.cursor,'c2');
});
test('mutation restarts from the original cursor and discards partial data',async()=>{
 const cursors=[]; let calls=0; const result=await collectSync('original',async cursor=>{
  cursors.push(cursor); calls++; if(calls===1) return {...page('partial'),added:[transaction('discard')],has_more:true};
  if(calls===2) throw new SyncError('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION');
  return {...page('final'),added:[transaction('keep')]};
 });
 assert.deepEqual(cursors,['original','partial','original']); assert.deepEqual(result.transactions.map(t=>t.transaction_id),['keep']);
});
test('failed page and nonadvancing cursor fail the batch',async()=>{
 await assert.rejects(()=>collectSync(null,async()=>{throw new SyncError('PLAID_UNAVAILABLE');}));
 await assert.rejects(()=>collectSync('c1',async()=>({...page('c1'),has_more:true})));
});
test('malformed amounts cannot enter a batch',()=>assert.throws(()=>normalizeTransaction({...transaction(),amount:NaN})));
