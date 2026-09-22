"use client";
import {useRef,useState} from 'react';
export function parseAmount(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a non-negative dollar amount with at most two decimal places.');
  const amount = Number(value); if (!Number.isFinite(amount) || amount > 1000000) throw new Error('Enter an amount up to $1,000,000.');
  return amount;
}
export default function AmountEditor({amount,label,onSave,buttonLabel,explanation}:{amount:number;label:string;onSave:(amount:number)=>Promise<void>;buttonLabel?:string;explanation?:string}) {
  const [editing,setEditing]=useState(false),[value,setValue]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const lock=useRef(false);
  async function save(){if(lock.current)return;let parsed;try{parsed=parseAmount(value);}catch(e){setError((e as Error).message);return;}lock.current=true;setBusy(true);setError('');try{await onSave(parsed);setEditing(false);}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}}
  return <div>{editing ? <form onSubmit={e=>{e.preventDefault();void save();}} className="space-y-2 mt-2">
    <label className="block text-sm">{label}<input autoFocus inputMode="decimal" value={value} disabled={busy} onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'&&!busy)setEditing(false);}} className="block w-full bg-zinc-950 border border-zinc-600 rounded-lg p-2 mt-1" /></label>
    {explanation&&<p className="text-xs text-zinc-400">{explanation}</p>}
    <button disabled={busy} className="rounded-lg bg-green-700 px-3 py-2">{busy?'Saving…':'Save'}</button><button type="button" disabled={busy} onClick={()=>setEditing(false)} className="ml-2 p-2">Cancel</button>
    {error&&<p role="alert" className="text-red-300 text-sm">{error}</p>}
  </form>:<button aria-label={label} className="text-green-300 underline decoration-dotted underline-offset-4 py-2 text-left" onClick={()=>{setValue(String(amount));setError('');setEditing(true);}}>{buttonLabel??amount.toLocaleString(undefined,{style:'currency',currency:'USD'})}</button>}</div>;
}
