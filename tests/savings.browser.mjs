import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
// Synthetic state only: every Supabase request is intercepted, including auth and writes.
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-US'});
const page=await context.newPage();
const userId='00000000-0000-4000-8000-000000000001';
const user={id:userId,aud:'authenticated',role:'authenticated',email:'fixture@example.com',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')+'.fixture';
const today=new Date();
const month=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
const next=new Date(today.getFullYear(),today.getMonth()+1,1);
const nextMonth=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0');
const overrides=new Map();
const writes=[];
const errors=[];
const requests=[];
let failSave=false,failReset=false,denyReset=false,failBudget=false,missingIncome=false,missingSetting=false;
let savingsPerPaycheck=600;
let holdWrite=null;
const tx=(id,category_id,amount,extra={})=>({id,category_id,amount,transaction_date:month+'-10',excluded_from_budget:false,is_transfer:false,plaid_removed_at:null,...extra});
page.on('pageerror',error=>errors.push(error.message));
await page.route('https://**.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  const send=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  requests.push({path:url.pathname,method:req.method()});
  if(url.pathname==='/auth/v1/token') return send({access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user});
  if(url.pathname==='/auth/v1/user') return send(user);
  if(url.pathname==='/auth/v1/logout') return send({});
  if(url.pathname.startsWith('/rest/v1/rpc/')) {
    const name=url.pathname.split('/').pop();
    assert.ok(['create_month_budget','create_month_income','expected_paychecks_for_month'].includes(name));
    const body=req.postDataJSON();assert.match(body.target_month,/^\d{4}-\d{2}-01$/);
    return send(name==='expected_paychecks_for_month'?Array.from({length:body.target_month.startsWith(nextMonth)?3:2},()=>({})):null);
  }
  if(url.pathname.endsWith('/monthly_savings_overrides') && req.method()==='POST') {
    const body=req.postDataJSON();assert.equal(body.user_id,userId);
    assert.equal(url.searchParams.get('on_conflict'),'user_id,month');
    writes.push({method:'save',...body});
    if(holdWrite) await holdWrite;
    if(failSave) return send({message:'Synthetic save failure'},500);
    overrides.set(body.month,body.savings_target_override);return send(null,201);
  }
  if(url.pathname.startsWith('/rest/v1/')) {
    assert.equal(url.searchParams.get('user_id'),'eq.'+userId,'Owner filter required');
    const selected=url.searchParams.get('month')?.slice(3);
    if(url.pathname.endsWith('/monthly_savings_overrides')) {
      assert.match(selected,/^\d{4}-\d{2}-01$/);
      if(req.method()==='DELETE') {
        writes.push({method:'reset',month:selected});
        if(failReset) return send({message:'Synthetic reset failure'},500);
        if(denyReset) return send([]);
        const existed=overrides.delete(selected);return send(existed?[{month:selected}]:[]);
      }
      return send(overrides.has(selected)?{savings_target_override:overrides.get(selected)}:null);
    }
    assert.equal(req.method(),'GET','Only monthly overrides may be written');
    const offset=Number(url.searchParams.get('offset')||0);
    if(url.pathname.endsWith('/budget_categories')) return send(offset?[]:[{id:'food',name:'Food',monthly_limit:1000,category_type:'variable'},{id:'home',name:'Home',monthly_limit:1000,category_type:'fixed'}]);
    if(url.pathname.endsWith('/budget_months')) return failBudget?send({message:'Synthetic month budget failure'},500):send([{category_id:'food',budget_amount:800}]);
    if(url.pathname.endsWith('/monthly_savings_summary')) return send(missingIncome?null:{expected_income:5000,projected_surplus:999999,monthly_savings_goal:999999});
    if(url.pathname.endsWith('/settings')) return send(missingSetting?null:{savings_per_paycheck:savingsPerPaycheck});
    if(url.pathname.endsWith('/bank_connections')) return send([{id:'fixture-bank'}]);
    if(url.pathname.endsWith('/transactions')) return send(offset?[]:[tx('1','food',900),tx('2',null,50),tx('3','food',10000,{is_transfer:true})]);
  }
  throw new Error('Unexpected request: '+req.method()+' '+url.pathname);
});
async function openSavings() {
  await page.getByRole('button',{name:'Savings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Savings',exact:true})).toBeVisible();
}
async function edit(value,key='Enter') {
  await page.getByRole('button',{name:'Edit monthly savings target'}).click();
  await page.getByLabel('Monthly savings target',{exact:true}).fill(value);
  await page.getByLabel('Monthly savings target',{exact:true}).press(key);
}
async function target(value) { await expect(page.getByTestId('savings-target')).toHaveText(value); }
async function refresh() { await page.getByRole('button',{name:'Refresh',exact:true}).click(); }
try {
  await page.goto(process.env.BUDGET_TEST_URL||'http://localhost:3000');
  await page.getByPlaceholder('Email address').fill(user.email);
  await page.getByPlaceholder('Password').fill('fixture-only-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await openSavings();
  await target('$1,200.00');
  await expect(page.getByTestId('savings-automatic')).toHaveText('$1,200.00');
  await expect(page.getByTestId('savings-income')).toHaveText('$5,000.00');
  await expect(page.getByTestId('savings-budget')).toHaveText('$1,800.00');
  await expect(page.getByTestId('savings-surplus')).toHaveText('$3,200.00');
  await expect(page.getByTestId('savings-support')).toContainText('$2,000.00 remains');
  await expect(page.getByText(/already over budget by \$100.00/)).toBeVisible();
  await expect(page.getByText(/1 transactions totaling \$50.00/)).toBeVisible();
  console.log('PASS: automatic calculation, effective monthly budget, income, surplus, support, spending risks');
  await edit('4000'); await target('$4,000.00');
  assert.equal(writes.length,1,'Enter/blur must not duplicate writes');
  await expect(page.getByTestId('savings-automatic')).toHaveText('$1,200.00');
  await expect(page.getByTestId('savings-support')).toContainText('Shortfall: $800.00');
  await page.screenshot({path:'/tmp/savings-v2-desktop.png',fullPage:true});
  await page.reload(); await openSavings(); await target('$4,000.00');
  await page.getByRole('button',{name:'Next →',exact:true}).click(); await target('$1,800.00');
  await edit('2500'); await target('$2,500.00');
  await page.getByRole('button',{name:'← Previous',exact:true}).click(); await target('$4,000.00');
  assert.equal(overrides.get(nextMonth+'-01'),2500); assert.equal(savingsPerPaycheck,600);
  console.log('PASS: monthly override survives refresh, separate months and permanent default preserved');
  const beforeCancel=writes.length;
  await edit('123','Escape'); await target('$4,000.00'); assert.equal(writes.length,beforeCancel);
  await page.getByRole('button',{name:'Edit monthly savings target'}).click();
  await page.getByLabel('Monthly savings target',{exact:true}).fill('123');
  await page.getByLabel('Monthly savings target',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'Cancel',exact:true}).press('Enter');
  await target('$4,000.00'); assert.equal(writes.length,beforeCancel,'Keyboard cancel must not save');
  await edit(''); await expect(page.getByRole('alert').filter({hasText:/\S/})).toContainText('Enter a non-negative amount'); assert.equal(writes.length,beforeCancel);
  await page.getByLabel('Monthly savings target',{exact:true}).fill('-1');
  await page.getByLabel('Monthly savings target',{exact:true}).press('Enter'); assert.equal(writes.length,beforeCancel);
  await page.getByLabel('Monthly savings target',{exact:true}).fill('1.001');
  await page.getByLabel('Monthly savings target',{exact:true}).press('Enter'); assert.equal(writes.length,beforeCancel);
  await page.getByLabel('Monthly savings target',{exact:true}).press('Escape');
  await page.getByRole('button',{name:'Edit monthly savings target'}).click();
  await page.getByLabel('Monthly savings target',{exact:true}).fill('0');
  await page.getByRole('heading',{name:'Savings',exact:true}).click(); await target('$0.00');
  assert.equal(overrides.get(month+'-01'),0);
  console.log('PASS: Escape, validation, zero override and click-away save');
  failSave=true; await edit('1234');
  await expect(page.getByRole('alert').filter({hasText:/\S/})).toContainText('Synthetic save failure');
  assert.equal(overrides.get(month+'-01'),0);
  failSave=false; await page.getByLabel('Monthly savings target',{exact:true}).press('Enter'); await target('$1,234.00');
  failReset=true; await page.getByRole('button',{name:'Reset to automatic target'}).click();
  await expect(page.getByRole('alert').filter({hasText:/\S/})).toContainText('Synthetic reset failure'); await target('$1,234.00');
  failReset=false; denyReset=true; await page.getByRole('button',{name:'Reset to automatic target'}).click();
  await expect(page.getByRole('alert').filter({hasText:/\S/})).toContainText('Reset was not confirmed'); await target('$1,234.00');
  denyReset=false; await page.getByRole('button',{name:'Reset to automatic target'}).click(); await target('$1,200.00');
  assert.equal(overrides.has(month+'-01'),false); assert.equal(overrides.get(nextMonth+'-01'),2500);
  await page.reload(); await openSavings(); await target('$1,200.00');
  savingsPerPaycheck=700; await refresh(); await target('$1,400.00');
  console.log('PASS: save/reset failure recovery, denied delete detection, reset persistence and future automatic recalculation');
  let release; holdWrite=new Promise(resolve=>{release=resolve;});
  await edit('1500');
  await expect(page.getByRole('button',{name:'Next →',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeDisabled();
  release();holdWrite=null; await target('$1,500.00');
  console.log('PASS: pending writes prevent month/navigation races');
  missingIncome=true; await refresh();
  await expect(page.getByTestId('savings-support')).toContainText('cannot be calculated');
  await expect(page.getByTestId('savings-income')).toHaveText('Not available');
  missingIncome=false;missingSetting=true; await refresh();await target('$1,500.00');
  await expect(page.getByTestId('savings-automatic')).toHaveText('Not available');
  await page.getByRole('button',{name:'Reset to automatic target'}).click(); await target('Set monthly target');
  missingSetting=false;await refresh();await target('$1,400.00');
  failBudget=true; await refresh(); await expect(page.getByRole('alert').filter({hasText:/\S/})).toContainText('Synthetic month budget failure');
  await expect(page.getByTestId('savings-target')).toHaveCount(0);
  failBudget=false; await refresh(); await target('$1,400.00');
  console.log('PASS: missing income/default and failed monthly budget do not show misleading support');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/savings-v2-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No mobile overflow');
  await page.getByRole('button',{name:'Review budget',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Budget',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Transactions',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Transactions',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Accounts',exact:true}).click();
  await expect(page.getByRole('button',{name:'Connect Bank',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
  await expect(page.getByTestId('savings-target')).toHaveCount(0);
  assert.deepEqual(errors,[]);
  assert.equal(requests.some(r=>r.path.includes('/functions/')),false,'Savings must not call Plaid or AI');
  console.log('PASS: mobile layout, existing top-level pages, auth clearing, no browser exceptions or bank calls');
} finally {await browser.close();}
