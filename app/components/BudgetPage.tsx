import type { summarizeBudget } from "../lib/budget";
type Props = { summary: ReturnType<typeof summarizeBudget>; editMonthlyBudget: (name: string, amount: number) => Promise<void>; editDefaultBudget: (name: string, amount: number) => Promise<void>; };
const money = (amount: number) => amount.toLocaleString(undefined, {style: "currency", currency: "USD"});
export default function BudgetPage({summary, editMonthlyBudget, editDefaultBudget}: Props) {
    return <>
      <h2 className="text-3xl font-bold mb-2">Budget</h2>

      <p className="text-zinc-400 mb-6">Categorized spending includes pending purchases and subtracts refunds and credits. Transfers, excluded transactions, and removed transactions do not count. Past months use your current category limits.</p>
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="rounded-2xl bg-zinc-900 p-5">Budgeted<p className="text-2xl font-bold">{money(summary.budget)}</p></div>
        <div className="rounded-2xl bg-zinc-900 p-5">Spent<p className="text-2xl font-bold">{money(summary.spent)}</p></div>
        <div className="rounded-2xl bg-zinc-900 p-5">Remaining<p className="text-2xl font-bold">{money(summary.remaining)}</p></div>
      </div>
      {summary.rows.length === 0 && <p>No active budget categories yet.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {summary.rows.map(category => <div key={category.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <h3 className="font-semibold text-lg">{category.name}</h3>
          <p className="text-zinc-400 text-sm capitalize">{category.category_type}</p>
          <button
  onClick={() => { void editMonthlyBudget(category.name, category.limit); }}
  className="mt-2 text-sm text-green-400 hover:text-green-300"
>
  Edit budget
</button>
<button
  onClick={() => { void editDefaultBudget(category.name, category.limit); }}
  className="mt-2 ml-4 text-sm text-blue-400 hover:text-blue-300"
>
  Change default
</button>

          <dl className="grid grid-cols-3 gap-3 mt-4">
            <div><dt className="text-zinc-400 text-sm">Budgeted</dt><dd>{money(category.limit)}</dd></div>
            <div><dt className="text-zinc-400 text-sm">Spent</dt><dd>{money(category.spent)}</dd></div>
            <div><dt className="text-zinc-400 text-sm">Remaining</dt><dd className={category.remaining < 0 ? "text-red-400" : "text-green-400"}>{money(category.remaining)}</dd></div>
          </dl>
          {category.remaining < 0 && <p className="text-red-400 text-sm mt-3">Over budget by {money(-category.remaining)}</p>}
        </div>)}
      </div>
    </>;
  }
