"use client";
import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {actionDescription,type CoachProposal} from '../lib/coach-actions';
import type { ChatMessage } from '../lib/chat';
type Reply = {proposal?:CoachProposal|null;proposalError?:string;answer:string;month:string;asOf:string;facts:{expectedIncome:number|null;target:number|null;plannedSpending:number;actualSpending:number;unassignedSpending:number;cautiousHeadroom:number|null}};

const money = (value:number|null) => value === null ? 'Not available' : value.toLocaleString('en-US',{style:'currency',currency:'USD'});
export default function BudgetCoach({month,userId,supabase,onApplied}:{month:string;userId:string;supabase:SupabaseClient;onApplied:()=>Promise<unknown>}) {
  const [messages,setMessages] = useState<ChatMessage[]>([]);
  const [decision,setDecision]=useState('');
  const [deciding,setDeciding]=useState(false);
  const decisionLock=useRef(false);
  const [draft,setDraft] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [latest,setLatest] = useState<Reply|null>(null);
  const pending = useRef<AbortController|null>(null);
  const end = useRef<HTMLDivElement|null>(null);
  const input = useRef<HTMLTextAreaElement|null>(null);
  useEffect(() => () => {pending.current?.abort();pending.current=null;},[]);
  useEffect(() => { if(messages.length) end.current?.scrollIntoView({block:'nearest'}); },[messages,busy]);
  async function send(question = draft) {
    const content = question.trim();
    if (!content || content.length > 2000 || pending.current) return;
    const controller = new AbortController(); pending.current=controller; setBusy(true);setError('');
    const history: ChatMessage[] = [...messages.slice(-6).map(message => ({...message,content:message.content.slice(0,2000)})),{role:'user',content}];
    try {
      const {data:{session},error:sessionError} = await supabase.auth.getSession();
      if (sessionError || !session || session.user.id !== userId) throw new Error('Your session expired. Sign in again.');
      if (controller.signal.aborted) return;
      const {data:result,error:invokeError} = await supabase.functions.invoke('ai-budget-chat',{body:{month,messages:history},headers:{Authorization:'Bearer '+session.access_token},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(55000)])});
      if (invokeError) {
        let detail = 'AI Coach is unavailable. Please try again.';
        if ('context' in invokeError && invokeError.context instanceof Response) {
          try { const body = await invokeError.context.json(); if (typeof body.error === 'string') detail=body.error; } catch {}
        }
        throw new Error(detail);
      }
      if (result.month !== month || typeof result.answer !== 'string' || !result.facts) throw new Error('The answer could not be verified. Please try again.');
      if (pending.current !== controller) return;
      setMessages(previous => [...previous,{role:'user',content},{role:'assistant',content:result.answer}].slice(-20) as ChatMessage[]);
      setLatest(result);setDecision('');setDraft('');
    } catch (error) {
      if (pending.current === controller && !controller.signal.aborted) {
        setDraft(content); setError(error instanceof Error ? error.message : 'Could not reach AI Coach. Try again.');
      }
    } finally {
      if (pending.current === controller) {pending.current=null;setBusy(false);input.current?.focus();}
    }
  }
  function clear() { pending.current?.abort();pending.current=null;setBusy(false);setMessages([]);setLatest(null);setError('');setDraft('');input.current?.focus(); }
return <section className="max-w-3xl mx-auto space-y-5 pb-36" aria-labelledby="coach-heading">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-green-400 text-xs font-semibold tracking-widest">YOUR BUDGET, IN CONVERSATION</p><h2 id="coach-heading" className="text-2xl font-bold mt-2">AI Coach</h2><p className="text-zinc-400 mt-2 text-sm">Plan a change, protect your savings, and understand {month}.</p></div>
      <button disabled={deciding} onClick={clear} className="shrink-0 rounded-xl border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800">New chat</button>
    </div>
    <p className="rounded-xl border border-green-900 bg-green-950/30 p-4 text-sm text-green-200">Chat never applies changes by itself. Review the exact proposal and choose Approve or Reject. Each answer checks this month’s app data; expected income is a forecast, not a bank balance.</p>

    <div role="log" aria-label="Budget conversation" aria-live="polite" aria-relevant="additions" className="space-y-4">
      {messages.map((message,index) => <article key={index} className={'rounded-2xl border p-4 sm:p-5 '+(message.role==='user'?'border-zinc-700 bg-zinc-800 sm:ml-10':'border-zinc-800 bg-zinc-900')}><p className="text-xs font-semibold mb-2 text-green-400">{message.role==='user'?'You':'AI Coach · suggestion'}</p><p className="whitespace-pre-wrap wrap-anywhere text-sm leading-7">{message.content}</p></article>)}
    </div>
    {busy && <div role="status" className="rounded-xl border border-zinc-800 p-4 text-zinc-400 text-sm">Checking your monthly budget and savings… <button onClick={() => {pending.current?.abort();pending.current=null;setBusy(false);}} className="ml-2 underline text-zinc-200">Cancel</button></div>}
    {latest && <details className="rounded-xl border border-zinc-800 p-4 text-sm"><summary className="cursor-pointer text-zinc-300">App facts used · {latest.month}</summary><dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">{([['Expected income',latest.facts.expectedIncome],['Savings target',latest.facts.target],['Planned spending',latest.facts.plannedSpending],['Categorized actual spending',latest.facts.actualSpending],['Unassigned spending',latest.facts.unassignedSpending],['Projected headroom after spending risks',latest.facts.cautiousHeadroom]] as [string,number|null][]).map(([label,value]) => <div key={label}><dt className="text-zinc-500">{label}</dt><dd className="font-semibold mt-1">{money(value)}</dd></div>)}</dl><p className="text-zinc-500 mt-3">Checked {new Date(latest.asOf).toLocaleString()}. Headroom is a forecast after reserving category budgets or higher actual spending, unassigned expenses, and your savings target. Remaining bills and available cash still need confirmation.</p></details>}
    {latest?.proposalError&&<p role="alert">{latest.proposalError}</p>}
    {latest?.proposal&&<section aria-label="Proposed app changes" className="border border-amber-700 rounded-xl p-4 space-y-3"><h3 className="font-semibold">Review exact changes</h3><ul className="list-disc pl-5">{latest.proposal.actions.map((a,i)=><li key={i}>{actionDescription(a,latest.proposal!.before_values[i],latest.month)}</li>)}</ul><p className="text-xs text-zinc-400">Expires {new Date(latest.proposal.expires_at).toLocaleTimeString()}. New budget or spending data invalidates this proposal.</p>{!decision&&<div className="flex gap-3">{[true,false].map(approve=><button key={String(approve)} disabled={deciding||busy} className="border border-zinc-600 rounded-lg px-4 py-2" onClick={async()=>{if(decisionLock.current)return;decisionLock.current=true;setDeciding(true);try{const {data,error}=await supabase.rpc('decide_coach_proposal',{proposal_id:latest.proposal!.id,approve});if(error||data?.status!==(approve?'approved':'rejected')){setError('Change was not confirmed. Refresh and request a new proposal; it may be stale.');setDecision('Not applied or unconfirmed. Refresh canonical data before retrying.');return;}setDecision(approve?'Approved and applied.':'Rejected. Nothing changed.');if(approve)await onApplied();}catch{setError('Could not confirm the change. Refresh your data before retrying.');}finally{decisionLock.current=false;setDeciding(false);}}}>{deciding?'Please wait…':approve?'Approve changes':'Reject'}</button>)}</div>}{decision&&<p role="status">{decision}</p>}</section>}
    <div ref={end}/>
    {error && <p role="alert" className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-200 text-sm">{error} Your question is below so you can retry.</p>}
   <form
  onSubmit={event => {
    event.preventDefault();
    void send();
  }}
  className="sticky bottom-0 z-30 -mx-2 rounded-2xl border border-zinc-700 bg-zinc-900/95 p-3 shadow-2xl backdrop-blur pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:mx-0 sm:p-4"
>
  <label htmlFor="coach-question" className="text-sm font-medium">
    Ask about your budget
  </label>

  <div className="mt-2 flex items-end gap-2">
    <textarea
      ref={input}
      id="coach-question"
      value={draft}
      onChange={event => setDraft(event.target.value)}
      disabled={busy}
      maxLength={2000}
      rows={2}
      placeholder="Ask about this month’s budget..."
      className="min-h-[52px] max-h-28 flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-green-600 disabled:opacity-50"
    />

    <button
      type="submit"
      disabled={busy || deciding || !draft.trim()}
      className="shrink-0 rounded-xl bg-green-500 px-4 py-3 font-semibold text-zinc-950 hover:bg-green-400 disabled:opacity-40"
    >
      {busy ? "Thinking…" : "Send"}
    </button>
  </div>

  <div className="mt-2 text-right text-xs text-zinc-500">
    {draft.length}/2,000
  </div>
</form>
    <p className="text-xs text-zinc-500 leading-5">Your question, recent chat turns and a compact monthly summary are sent to OpenAI. Transaction details are included only for transaction questions, up to 12 recent rows. Chat is kept only in this page session and clears when you change month, refresh, leave this section, or sign out. Check suggestions before editing Budget or Savings.</p>
  </section>;
}
