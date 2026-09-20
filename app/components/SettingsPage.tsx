"use client";
import {useEffect,useId,useState,type ReactNode} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {App} from '@capacitor/app';
import {nativeIOS,refreshWidget} from '../lib/native';
import {widgetSelection} from '../lib/widget';
export function PasswordForm({supabase,onComplete}:{supabase:SupabaseClient;onComplete?:()=>void}){
 const [password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 return <form className="space-y-3" onSubmit={async e=>{e.preventDefault();setStatus('');if(password.length<12||password!==confirm){setStatus('Use at least 12 characters and matching passwords.');return;}setBusy(true);const {error}=await supabase.auth.updateUser({password});setBusy(false);if(error){setStatus('Password could not be changed. You may need a fresh recovery link or to sign in again.');return;}setPassword('');setConfirm('');setStatus('Password changed.');onComplete?.();}}>
 <label className="block">New password<input required autoComplete="new-password" type="password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} className="block bg-zinc-950 border border-zinc-600 rounded-lg p-3 w-full"/></label>
 <label className="block">Confirm password<input required autoComplete="new-password" type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} className="block bg-zinc-950 border border-zinc-600 rounded-lg p-3 w-full"/></label>
 <button disabled={busy} className="bg-green-700 rounded-lg px-4 py-2">{busy?'Saving…':'Change password'}</button>{status&&<p role="status">{status}</p>}</form>;
}
function SettingsSection({title,children}:{title:string;children:ReactNode}){
 const [expanded,setExpanded]=useState(false);const panelId=useId(),headingId=useId();
 return <section className="overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800"><h3><button id={headingId} type="button" aria-expanded={expanded} aria-controls={panelId} onClick={()=>setExpanded(value=>!value)} className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-green-400"><span>{title}</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={'h-5 w-5 shrink-0 text-zinc-400 '+(expanded?'rotate-180':'')}><path d="m6 9 6 6 6-6"/></svg></button></h3><div id={panelId} role="region" aria-labelledby={headingId} hidden={!expanded} className="border-t border-zinc-800 p-5">{children}</div></section>;
}
export default function SettingsPage({supabase,userId,categories}:{supabase:SupabaseClient;userId:string;categories:{name:string}[]}){
 const [selected,setSelected]=useState(()=>widgetSelection(userId)),[status,setStatus]=useState(''),[version,setVersion]=useState('0.2.0 (web)');
 useEffect(()=>{if(nativeIOS())void App.getInfo().then(info=>setVersion(info.version+' ('+info.build+')'));},[]);
 return <div className="space-y-6 max-w-2xl"><h2 className="text-3xl font-bold">Settings</h2>
 <SettingsSection title="Change password"><PasswordForm supabase={supabase}/></SettingsSection>
 <SettingsSection title="Widget settings"><p className="text-zinc-400 mb-3">Choose up to three categories for this device. Their remaining amounts appear in the Home Screen widget and optional Lock Screen widget. Uncheck all to hide them. Open the app to refresh; iOS controls widget refresh timing.</p>
 {categories.map(c=><label key={c.name} className="flex items-center gap-3 py-2"><input type="checkbox" checked={selected.includes(c.name)} disabled={!selected.includes(c.name)&&selected.length>=3} onChange={e=>{const next=e.target.checked?[...selected,c.name]:selected.filter(n=>n!==c.name);setSelected(next);localStorage.setItem('budget-live-widget:'+userId,JSON.stringify(next));setStatus('Saved for this device.');void refreshWidget(supabase,userId).catch(()=>setStatus('Saved. Open the app again to retry updating the widget.'));}}/>{c.name}</label>)}{status&&<p role="status">{status}</p>}</SettingsSection>
 <SettingsSection title="Privacy / Security"><p>Your account controls access to your budget. Bank credentials stay with Plaid; bank access tokens and the OpenAI key stay on the server. AI questions send a limited budget summary to OpenAI. AI suggestions require your approval before a supported change. Signing out clears the widget data on this device. Disconnect banks from Accounts; imported history remains.</p></SettingsSection>
 <SettingsSection title="App info"><p>Budget Live {version}</p><p className="text-zinc-400">Private testing build · USD</p></SettingsSection></div>;
}
