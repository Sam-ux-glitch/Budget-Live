import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1280,height:1000},locale:'en-US'});
const page=await context.newPage();
const userId='00000000-0000-4000-8000-000000000001';
const user={id:userId,aud:'authenticated',role:'authenticated',email:'fixture@example.com',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')+'.fixture';
const errors=[],requests=[];let mode='ok',release;
page.on('pageerror',error=>errors.push(error.message));
await page.route('https://**.supabase.co/**',async route=>{
 const req=route.request(),url=new URL(req.url());const send=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 if(url.pathname==='/auth/v1/token') return send({access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user});
 if(url.pathname==='/auth/v1/user') return send(user);
 if(url.pathname==='/auth/v1/logout') return send({});
 if(url.pathname.startsWith('/rest/v1/rpc/')) {const name=url.pathname.split('/').pop();assert.ok(['create_month_budget','create_month_income','expected_paychecks_for_month'].includes(name));return send(name==='expected_paychecks_for_month'?[{},{}]:null);}
 assert.equal(req.method(),'GET','No financial writes in chat');assert.equal(url.searchParams.get('user_id'),'eq.'+userId);
 const offset=Number(url.searchParams.get('offset')||0);
 if(url.pathname.endsWith('/budget_categories')) return send(offset?[]:[{id:'food',name:'Groceries',monthly_limit:400,category_type:'variable'}]);
 if(url.pathname.endsWith('/budget_months')) return send([]);
 if(url.pathname.endsWith('/monthly_savings_summary')) return send({expected_income:3000});
 if(url.pathname.endsWith('/settings')) return send({savings_per_paycheck:300});
 if(url.pathname.endsWith('/monthly_savings_overrides')) return send(null);
 if(url.pathname.endsWith('/bank_connections')) return send([]);
 if(url.pathname.endsWith('/transactions')) return send([]);
 throw new Error('Unexpected Supabase request '+url.pathname);
});
await page.route('https://**.supabase.co/functions/v1/ai-budget-chat',async route=>{
 const req=route.request(),body=req.postDataJSON();requests.push(body);
 assert.equal(req.headers().authorization,'Bearer '+token);assert.deepEqual(Object.keys(body).sort(),['messages','month']);
 if(mode==='hold') await new Promise(resolve=>release=resolve);
 if(mode==='error') return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic provider unavailable'})});
 return route.fulfill({contentType:'application/json',body:JSON.stringify({answer:'Your data: '+body.month+' expected income is $3,000; your savings target is $600. Suggestion: confirm remaining bills before reallocating any money.',month:body.month,asOf:new Date().toISOString(),facts:{expectedIncome:3000,target:600,plannedSpending:400,actualSpending:0,unassignedSpending:0,cautiousHeadroom:2000}})});
});
try {
 await page.goto(process.env.BUDGET_TEST_URL||'http://localhost:3000');
 await page.getByPlaceholder('Email address').fill(user.email);await page.getByPlaceholder('Password').fill('fixture-only-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'AI Coach',exact:true}).click();
 await expect(page.getByRole('heading',{name:'AI Coach',exact:true})).toBeVisible();
 await expect(page.getByText('Chat never applies changes by itself.',{exact:false})).toBeVisible();
 for(const question of ['Groceries are costing an extra $100 this week. Where can I take that money from?','I have an unexpected $300 dental expense this month. How should I adjust the budget?','I spent less than expected this month. How much extra can go to savings?']) {
  await page.getByRole('button',{name:question,exact:true}).click();await expect(page.getByRole('log')).toContainText('expected income is $3,000');assert.equal(requests.at(-1).messages.at(-1).content,question);await page.getByRole('button',{name:'New chat',exact:true}).click();
 }
 console.log('PASS: empty state, all three starter scenarios, verified request shape, read-only behavior');
 const input=page.getByLabel('Ask about your budget');
 await input.fill('Can I afford a $100 purchase?');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('log')).toContainText('Suggestion:');
 await input.fill('What about $200?');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('log')).toContainText('What about $200?');assert.equal(requests.at(-1).messages.length,3);
 await page.getByText(/App facts used/).click();await expect(page.getByText('$600.00',{exact:true})).toBeVisible();
 await page.screenshot({path:'/tmp/coach-desktop.png',fullPage:true});
 mode='error';await input.fill('Retry this question');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:/\S/})).toContainText('Synthetic provider unavailable');await expect(input).toHaveValue('Retry this question');
 mode='ok';await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:/\S/})).toHaveCount(0);await expect(page.getByRole('log')).toContainText('Retry this question');
 console.log('PASS: follow-up history, actual-facts disclosure, recoverable errors and retry');
 mode='hold';await input.fill('Late response');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('button',{name:'Thinking…',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Next →',exact:true}).click();await expect(page.getByRole('log')).toBeEmpty();release();mode='ok';await expect(input).toHaveValue('');
 await input.fill('Question in new month');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByRole('log')).toContainText('Question in new month');assert.equal(requests.at(-1).messages.length,1);
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('log')).toBeEmpty();
 console.log('PASS: pending month change cancels/clears chat, new month has no old history, refresh clears stale facts');
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole('heading',{name:'AI Coach',exact:true})).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No mobile overflow');
 await page.screenshot({path:'/tmp/coach-mobile.png',fullPage:true});
 await input.fill('mobile keyboard question');await page.getByRole('button',{name:'Send',exact:true}).press('Enter');await expect(page.getByRole('log')).toContainText('mobile keyboard question');
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();await expect(page.getByRole('log')).toHaveCount(0);assert.deepEqual(errors,[]);
 console.log('PASS: mobile layout, keyboard send, sign-out clearing, no browser exceptions');
} finally {await context.close();await browser.close();}
