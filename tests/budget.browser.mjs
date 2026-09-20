import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
// All Supabase traffic is intercepted. No real credentials, bank calls, or database writes.
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1280,height:900}});
const page = await context.newPage();
const userId = '00000000-0000-4000-8000-000000000001';
const user = {id:userId,aud:'authenticated',role:'authenticated',email:'fixture@example.com',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const token = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')+'.fixture-signature';
const categories=[{id:'food',name:'Food',monthly_limit:1000,category_type:'variable'},{id:'travel',name:'Travel',monthly_limit:50,category_type:'variable'}];
const transaction=(id,amount,extra={})=>({id,category_id:'food',transaction_date:'2026-09-19',amount,excluded_from_budget:false,is_transfer:false,plaid_removed_at:null,merchant_name:'Test purchase',budget_categories:{name:'Food'},...extra});
let transactions=[...Array.from({length:1205},(_,i)=>transaction(String(i),1)),transaction('purchase',80),transaction('refund',-20),transaction('excluded',900,{excluded_from_budget:true}),transaction('transfer',300,{is_transfer:true}),transaction('removed',700,{plaid_removed_at:'2026-09-20'}),transaction('unassigned',30,{category_id:null})];
let failPage=false;
let failAi=false;
const calls=[];
const queryErrors=[];
const pageErrors=[];
page.on('pageerror',error=>pageErrors.push(error.message));
await page.route('https://**.supabase.co/**',async route=>{
  const url=new URL(route.request().url());
  const send=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(url.pathname==='/auth/v1/token') return send({access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user});
  if(url.pathname==='/auth/v1/user') return send(user);
  if(url.pathname==='/auth/v1/logout') return send({});
  if(url.pathname.includes('/functions/v1/')) {
    const name=url.pathname.split('/').pop();calls.push(name);
    if(name==='plaid-sync-transactions') return send({success:true,results:[]});
    if(name==='ai-categorize-transactions') {
      if(failAi) return send({error:'fixture failure'},500);
      transactions=transactions.filter(t=>t.id!=='new-refund').concat(transaction('new-refund',-5));
      return send({processed:1});
    }
    return send({error:'Unexpected function'},400);
  }
  if(url.pathname.startsWith('/rest/v1/rpc/')) {
    const name=url.pathname.split('/').pop();
    assert.ok(['create_month_budget','create_month_income','expected_paychecks_for_month'].includes(name));
    return send(name==='expected_paychecks_for_month'?[{},{}]:null);
  }
  if(url.pathname.startsWith('/rest/v1/')) {
    if(url.searchParams.get('user_id')!=='eq.'+userId) {queryErrors.push('Missing explicit owner filter');return send({message:'Missing owner'},403);}
    if(url.pathname.endsWith('/budget_months')) return send([]);
    if(url.pathname.endsWith('/monthly_savings_summary')) return send({expected_income:5000});
    if(url.pathname.endsWith('/settings')) return send({savings_per_paycheck:600});
    if(url.pathname.endsWith('/monthly_savings_overrides')) return send(null);
    const offset=Number(url.searchParams.get('offset')||0);
    const limit=Number(url.searchParams.get('limit')||500);
    if(url.pathname.endsWith('/budget_categories')) return send(categories.slice(offset,offset+limit));
    if(url.pathname.endsWith('/bank_connections')) return send([{id:'connection'}]);
    if(url.pathname.endsWith('/transactions')) {
      if(!url.searchParams.has('transaction_date')) return send(transactions.slice(0,100));
      const dates=url.searchParams.getAll('transaction_date');
      assert.equal(dates.length,2);
      assert.equal(url.searchParams.get('order'),'id.asc');
      if(failPage && offset>0) return send({message:'Synthetic page failure'},500);
      const month=dates.find(d=>d.startsWith('gte.')).slice(4,11);
      const rows=month==='2026-09'?transactions:[];
      return send(rows.slice(offset,offset+Math.min(limit,137)));
    }
  }
  return send({message:'Unexpected fixture request'},400);
});
let displayedMonth = new Date().getFullYear()*12 + new Date().getMonth();
async function selectMonth(month) {
  const [year,value]=month.split('-').map(Number);
  const target=year*12+value-1;
  while(displayedMonth!==target) {
    const direction=target>displayedMonth?1:-1;
    await page.getByRole('button',{name:direction===1?'Next →':'← Previous',exact:true}).click();
    displayedMonth+=direction;
  }
  const date=new Date(year,value-1,2);
  await expect(page.getByText('Budget month: '+date.toLocaleDateString('en-US',{month:'long',year:'numeric'}),{exact:true})).toBeVisible();
}
try {
  await page.goto(process.env.BUDGET_TEST_URL||'http://localhost:3000');
  await page.getByPlaceholder('Email address').fill('fixture@example.com');
  await page.getByPlaceholder('Password').fill('test-only-not-a-real-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await selectMonth('2026-09');
  await page.getByRole('button',{name:'Budget',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Budget',exact:true})).toBeVisible();
  await expect(page.getByText('$1,265.00',{exact:true})).toHaveCount(2);
  await expect(page.getByText('Over budget by $265.00')).toBeVisible();
  await expect(page.getByText(/1 transactions totaling \$30.00/)).toBeVisible();
  console.log('PASS: paginated category totals, refund, exclusions, overspending, unassigned warning');
  await selectMonth('2026-08');
  await expect(page.getByText('$1,265.00',{exact:true})).toHaveCount(0);
  await expect(page.getByText('$0.00',{exact:true})).toHaveCount(3);
  await selectMonth('2026-09');
  await expect(page.getByText('$1,265.00',{exact:true})).toHaveCount(2);
  console.log('PASS: month switching does not display prior-month totals');
  failPage=true;
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Could not load your budget'})).toContainText('Could not load your budget');
  await expect(page.getByText('$1,265.00',{exact:true})).toHaveCount(0);
  failPage=false;
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByText('$1,265.00',{exact:true})).toHaveCount(2);
  console.log('PASS: failed later page hides partial totals and refresh recovers');
  await page.getByRole('button',{name:'Accounts',exact:true}).click();
  await page.getByRole('button',{name:'Sync Transactions',exact:true}).click();
  await expect(page.getByText('Sync complete. AI categorized 1 transactions.')).toBeVisible();
  assert.deepEqual(calls,['plaid-sync-transactions','ai-categorize-transactions']);
  await page.getByRole('button',{name:'Budget',exact:true}).click();
  await expect(page.getByText('$1,260.00',{exact:true})).toHaveCount(2);
  console.log('PASS: sync calls AI and refreshes Budget amounts');
  failAi=true;
  await page.getByRole('button',{name:'Accounts',exact:true}).click();
  await page.getByRole('button',{name:'Sync Transactions',exact:true}).click();
  await expect(page.getByText(/AI categorization could not finish/)).toBeVisible();
  await page.getByRole('button',{name:'Budget',exact:true}).click();
  await expect(page.getByText('$1,260.00',{exact:true})).toHaveCount(2);
  console.log('PASS: AI failure preserves refreshed transactions');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/budget-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No mobile horizontal overflow');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
  await expect(page.getByText('$1,260.00',{exact:true})).toHaveCount(0);
  assert.deepEqual(queryErrors,[]);
  assert.deepEqual(pageErrors,[]);
  console.log('PASS: owner filters, sign-out clearing, mobile layout, no browser exceptions');
} finally {await browser.close();}
