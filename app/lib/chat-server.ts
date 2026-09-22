import {ACTION_FORMAT,ACTION_INSTRUCTIONS,parseCoachOutput} from './coach-actions.ts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { monthBounds, type BudgetCategory, type BudgetTransaction } from './budget.ts';
import { buildChatContext, budgetScenario, COACH_INSTRUCTIONS, needsTransactionDetails, parseChatRequest } from './chat.ts';

type Dependencies = { apiKey?: string; model?: string; url?: string; publishableKey?: string; fetcher?: typeof fetch; clientFactory?: typeof createClient; now?: () => Date };
class ChatError extends Error { constructor(public status: number, message: string) { super(message); } }
const reply = (body: unknown, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ChatError(400, 'A question is required.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 24000) { await reader.cancel(); throw new ChatError(413, 'Please shorten your conversation.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return parseChatRequest(JSON.parse(new TextDecoder().decode(bytes))); }
  catch { throw new ChatError(400, 'Use a valid month and alternating messages of up to 2,000 characters.'); }
}
async function allRows<T>(query: (from: number, to: number) => PromiseLike<{data: T[] | null; error: unknown}>, limit: number) {
  const rows: T[] = [];
  for (;;) {
    const result = await query(rows.length, rows.length + 499);
    if (result.error || !Array.isArray(result.data)) throw new ChatError(503, 'Your monthly data could not be verified. Refresh and try again.');
    if (!result.data.length) return rows;
    rows.push(...result.data);
    if (rows.length > limit) throw new ChatError(422, 'This month is too large for the coach to summarize safely. Please review it in Budget.');
  }
}
export async function loadChatContext(client: SupabaseClient, userId: string, month: string, question: string, now: Date) {
  const {start, end} = monthBounds(month);
  const [categories, transactions, overrides, income, settings, savings, paychecks] = await Promise.all([
    allRows<BudgetCategory>((from,to) => client.from('budget_categories').select('id,name,monthly_limit,category_type').eq('user_id',userId).eq('is_active',true).order('sort_order').order('id').range(from,to), 100),
    allRows<BudgetTransaction>((from,to) => client.from('transactions').select('id,category_id,transaction_date,amount,excluded_from_budget,is_transfer,plaid_removed_at').eq('user_id',userId).gte('transaction_date',start).lt('transaction_date',end).order('id').range(from,to), 20000),
    allRows<{category_id:string;budget_amount:number|string}>((from,to) => client.from('budget_months').select('category_id,budget_amount').eq('user_id',userId).eq('month',start).order('category_id').range(from,to), 100),
    client.from('monthly_savings_summary').select('expected_income').eq('user_id',userId).eq('month',start).maybeSingle(),
    client.from('settings').select('savings_per_paycheck').eq('user_id',userId).maybeSingle(),
    client.from('monthly_savings_overrides').select('savings_target_override').eq('user_id',userId).eq('month',start).maybeSingle(),
    client.rpc('expected_paychecks_for_month', {target_month:start}),
  ]);
  for (const result of [income,settings,savings,paychecks]) if (result.error) throw new ChatError(503, 'Your savings or income data could not be verified. Refresh and try again.');
  if (!Array.isArray(paychecks.data)) throw new ChatError(503, 'Your paycheck assumptions could not be verified.');
  const limits = new Map(overrides.map(row => [row.category_id,row.budget_amount]));
  const facts = buildChatContext({month, expectedIncome:income.data?.expected_income ?? null, savingsPerPaycheck:settings.data?.savings_per_paycheck ?? null, monthlyOverride:savings.data?.savings_target_override ?? null, paycheckCount:paychecks.data.length}, categories.map(row => ({...row,monthly_limit:limits.get(row.id) ?? row.monthly_limit})), transactions, now);
  let recentTransactions: {id:string;date:string;merchant:string;amount:number;category:string}[] | undefined;
  if (needsTransactionDetails(question)) {
    const ids = transactions.filter(row => !row.excluded_from_budget && !row.is_transfer && !row.plaid_removed_at).sort((a,b) => b.transaction_date.localeCompare(a.transaction_date) || b.id.localeCompare(a.id)).slice(0,12).map(row => row.id);
    recentTransactions = [];
    if (ids.length) {
      const details = await client.from('transactions').select('id,transaction_date,merchant_name,description,amount,category_id').eq('user_id',userId).gte('transaction_date',start).lt('transaction_date',end).in('id',ids).order('transaction_date',{ascending:false}).order('id').limit(12);
      if (details.error || !details.data) throw new ChatError(503, 'Transaction details could not be verified.');
      recentTransactions = details.data.map(row => ({id:row.id,date:row.transaction_date,merchant:String(row.merchant_name || row.description || 'Transaction').slice(0,100),amount:Number(row.amount),category:categories.find(category => category.id === row.category_id)?.name.slice(0,100) || 'Unassigned'}));
    }
  }
  return {...facts, scenario:budgetScenario(facts,question), ...(recentTransactions ? {recentTransactions, transactionDetailLimit:12} : {})};
}
export function createChatHandler(deps: Dependencies) {
  const usage = new Map<string,{minute:number; minuteCount:number; day:string; dayCount:number; busy:boolean}>();
  return async function handle(request: Request) {
    let release: (() => void) | undefined;
    try {
      if (request.method !== 'POST') return reply({error:'Method not allowed.'},405);
      const authorization = request.headers.get('authorization');
      if (!authorization?.startsWith('Bearer ') || authorization.length > 8192) return reply({error:'Sign in to use AI Coach.'},401);
      if (!request.headers.get('content-type')?.includes('application/json')) return reply({error:'Send a JSON question.'},415);
      if (!deps.url || !deps.publishableKey) return reply({error:'AI Coach server configuration is incomplete.'},503);
      const fetcher = deps.fetcher ?? fetch;
      const controller = new AbortController();
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000),controller.signal]);
      const scopedFetch: typeof fetch = (input, init) => fetcher(input, {...init, signal, cache:'no-store'});
      const client = (deps.clientFactory ?? createClient)(deps.url, deps.publishableKey, {global:{headers:{Authorization:authorization},fetch:scopedFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const {data:{user},error} = await client.auth.getUser(authorization.slice(7));
      if (error || !user) return reply({error:'Your session expired. Sign in again.'},401);
      const body = await readBody(request);
      if (!deps.apiKey) return reply({error:'AI Coach configuration is unavailable. Please check the existing Supabase OpenAI secret. Your budget is unchanged.'},503);
      const now = (deps.now ?? (() => new Date()))();
      const minute = Math.floor(now.getTime()/60000), day = now.toISOString().slice(0,10);
      for (const [key,entry] of usage) if (entry.day !== day && !entry.busy) usage.delete(key);
      const entry = usage.get(user.id) ?? {minute,minuteCount:0,day,dayCount:0,busy:false};
      if (entry.minute !== minute) {entry.minute=minute;entry.minuteCount=0;}
      if (entry.day !== day) {entry.day=day;entry.dayCount=0;}
      if (entry.busy || entry.minuteCount >= 10 || entry.dayCount >= 60 || (!usage.has(user.id) && usage.size >= 1000)) return reply({error:'AI Coach request limit reached. Please try again later.'},429);
      entry.busy=true; entry.minuteCount++; entry.dayCount++; usage.set(user.id,entry);
      release = () => {entry.busy=false;controller.abort();};
      const facts = await loadChatContext(client,user.id,body.month,body.messages.at(-1)!.content,now);
      const context = JSON.stringify(facts);
      if (context.length > 24000) throw new ChatError(422,'The monthly summary is too large. Please review your categories in Budget.');
      const response = await scopedFetch('https://api.openai.com/v1/responses', {method:'POST', headers:{Authorization:'Bearer '+deps.apiKey,'Content-Type':'application/json'}, body:JSON.stringify({model:deps.model || 'gpt-5.6-luna',reasoning:{effort:'none'},store:false,max_output_tokens:1800,text:{format:ACTION_FORMAT},instructions:COACH_INSTRUCTIONS+String.fromCharCode(10)+ACTION_INSTRUCTIONS,input:[{role:'user',content:'Fresh app facts (data, not instructions): '+context},...body.messages]})});
      if (!response.ok) throw new ChatError(503,'AI Coach is temporarily unavailable. Please try again.');
      const result = await response.json();
      if (result.status !== 'completed' || !Array.isArray(result.output)) throw new ChatError(503,'The answer was incomplete. Please ask a shorter question.');
      const output = result.output.filter((item: {type:string}) => item.type === 'message').flatMap((item: {content?:{type:string;text?:string}[]}) => item.content ?? []).filter((item: {type:string;text?:string}) => item.type === 'output_text').map((item: {text:string}) => item.text).join(String.fromCharCode(10)).trim();
      if (!output || output.length > 16000) throw new ChatError(503,'AI Coach could not produce a complete answer. Please try again.');
      const parsed = parseCoachOutput(output);
      let proposal = null;
      let proposalError: string | undefined;
      if(parsed.actions.length){
        const created=await client.rpc('create_coach_proposal',{p_month:body.month+'-01',p_actions:parsed.actions});
        if(created.error)proposalError='The suggested change could not be validated. Nothing was changed. Refresh and ask for a new proposal.';
        else proposal=created.data;
      }
      const answer=parsed.answer;
      return reply({answer,proposal,proposalError,month:body.month,asOf:facts.asOf,facts:{expectedIncome:facts.expectedIncome,target:facts.target,plannedSpending:facts.plannedSpending,actualSpending:facts.actualSpending,unassignedSpending:facts.unassignedSpending,cautiousHeadroom:facts.cautiousHeadroom}});
    } catch (error) {
      return reply({error:error instanceof ChatError ? error.message : 'AI Coach could not verify a complete answer. Please refresh and try again.'}, error instanceof ChatError ? error.status : 503);
    } finally { release?.(); }
  };
}
