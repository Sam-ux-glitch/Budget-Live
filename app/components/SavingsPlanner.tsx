import { useRef, useState } from "react";
import { parseSavingsTarget, type SavingsPlan } from "../lib/savings";

const money = (amount: number | null) => amount === null ? "Not available" : amount.toLocaleString(undefined, {style:"currency", currency:"USD"});

type Props = { plan: SavingsPlan; saving: boolean; onUpdate: (amount: number | null) => Promise<void>; onViewBudget: () => void };
export default function SavingsPlanner({plan, saving, onUpdate, onViewBudget}: Props) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const editingRef = useRef(false);
  const inFlight = useRef(false);
  async function update(amount: number | null) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError("");
    try {
      await onUpdate(amount);
      editingRef.current = false;
      setEditing(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save your target. Please retry.");
    } finally { inFlight.current = false; }
  }
  function save() {
    if (!editingRef.current || inFlight.current) return;
    try { void update(parseSavingsTarget(input)); }
    catch (failure) { setError((failure as Error).message); }
  }
  function cancel() { editingRef.current = false; setEditing(false); setError(""); }
  return <section className="space-y-4" aria-labelledby="savings-heading">
    <div>
      <h2 id="savings-heading" className="text-3xl font-bold">Savings</h2>
      <p className="mt-2 text-zinc-400">Plan savings for {plan.month}. Monthly changes leave your savings-per-paycheck default unchanged.</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-sm text-zinc-400">Expected income</p>
        <p data-testid="savings-income" className="mt-2 text-2xl font-semibold break-words">{money(plan.expectedIncome)}</p>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-sm text-zinc-400">Planned spending / budget</p>
        <p data-testid="savings-budget" className="mt-2 text-2xl font-semibold break-words">{money(plan.plannedSpending)}</p>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-sm text-zinc-400">Projected surplus</p>
        <p data-testid="savings-surplus" className="mt-2 text-2xl font-semibold break-words">{money(plan.projectedSurplus)}</p>
        <p className="mt-2 text-xs text-zinc-400">Expected income minus planned spending, before savings.</p>
      </div>
      <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-5">
        <p id="monthly-target-label" className="text-sm text-zinc-400">Savings target for {plan.month}</p>
        {editing ? <>
          <input aria-label="Monthly savings target" aria-describedby="target-help" aria-invalid={!!error}
            type="number" min="0" step="0.01" value={input} disabled={saving} autoFocus
            onChange={event => { setInput(event.target.value); setError(""); }} onBlur={event => {
              if (event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-savings-cancel]")) return;
              save();
            }}
            onKeyDown={event => {
              if (event.key === "Enter") { event.preventDefault(); save(); }
              if (event.key === "Escape") { event.preventDefault(); cancel(); }
            }}
            className="mt-2 w-full min-w-0 rounded-lg border border-zinc-600 bg-zinc-950 p-2 text-2xl disabled:opacity-50" />
          <button type="button" data-savings-cancel disabled={saving} onMouseDown={event => event.preventDefault()} onClick={cancel} className="mt-2 text-sm text-zinc-300 underline">Cancel</button>
        </> : <button type="button" data-testid="savings-target" disabled={saving}
          aria-label="Edit monthly savings target" title="Click to edit this month's savings target"
          onClick={() => { setInput(plan.target === null ? "" : String(plan.target)); editingRef.current = true; setEditing(true); setError(""); }}
          className="mt-2 max-w-full text-left text-2xl font-semibold text-green-300 hover:text-green-200 break-words disabled:opacity-50">
          {plan.target === null ? "Set monthly target" : money(plan.target)}
        </button>}
        <p id="target-help" className="mt-2 text-xs text-zinc-400">{editing ? "Enter or click outside to save. Escape cancels." : "Click the amount to edit this month only."}</p>
        <p className="mt-2 text-sm text-zinc-300">{plan.targetSource === "monthly_override" ? "Monthly override" : "Automatic target"}</p>
      </div>
    </div>
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-sm text-zinc-400">Automatic target for {plan.month}</p>
      <p data-testid="savings-automatic" className="mt-1 text-xl font-semibold">{money(plan.automaticTarget)}</p>
      <p className="mt-2 text-sm text-zinc-400">{plan.savingsPerPaycheck === null
        ? "No savings-per-paycheck default is configured. You can still set a target for this month."
        : money(plan.savingsPerPaycheck) + " per paycheck × " + plan.paycheckCount + " expected paycheck" + (plan.paycheckCount === 1 ? "" : "s") + "."}</p>
      {plan.targetSource === "monthly_override" && !editing && <button type="button" onClick={() => void update(null)} disabled={saving}
        className="mt-3 rounded-lg border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50">Reset to automatic target</button>}
    </div>
    {saving && <p role="status" className="text-zinc-300">Saving monthly target...</p>}
    {error && <p role="alert" className="rounded-xl border border-red-800 p-4 text-red-300">{error}</p>}
    <div data-testid="savings-support" className={"rounded-xl border p-5 " + (plan.status === "supported" ? "border-green-800 bg-green-950/20 text-green-200" : "border-amber-800 bg-amber-950/20 text-amber-200")}>
      <h3 className="font-semibold">{plan.status === "supported" ? "Your plan supports this savings target" : plan.status === "shortfall" ? "Your plan falls short of this savings target" : "Savings support cannot be calculated yet"}</h3>
      <p className="mt-2">{plan.status === "supported" ? money(plan.headroom) + " remains after planned spending and savings."
        : plan.status === "shortfall" ? "Shortfall: " + money(plan.shortfall) + ". Reduce planned spending, increase expected income, or adjust this month's savings target."
        : "Expected income and a savings target are both needed. Refresh after updating your income or savings settings."}</p>
      <p className="mt-2 text-sm">This is a monthly plan, not your current bank balance. Actual spending may change what is available.</p>
    </div>
    {(plan.categoryOverspending > 0 || plan.unassignedCount > 0) && <div className="rounded-xl border border-amber-800 p-5 text-amber-200">
      <h3 className="font-semibold">Spending to review</h3>
      {plan.categoryOverspending > 0 && <p className="mt-2">Categories are already over budget by {money(plan.categoryOverspending)} in total. Review their monthly allocations before relying on the projected surplus.</p>}
      {plan.unassignedCount > 0 && <p className="mt-2">{plan.unassignedCount} transactions totaling {money(plan.unassignedSpending)} have no active budget category. Review them for expenses outside your plan.</p>}
      <button type="button" disabled={saving} onClick={onViewBudget} className="mt-3 underline">Review budget</button>
    </div>}
  </section>;
}
