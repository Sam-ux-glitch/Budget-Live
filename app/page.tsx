"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { currentMonth, monthBounds, summarizeBudget, fetchAllPages, type BudgetCategory, type BudgetTransaction } from "./lib/budget";
import { createClient } from "@supabase/supabase-js";
import { usePlaidLink } from "react-plaid-link";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type Transaction = BudgetTransaction & {
  id: string;
  transaction_date: string;
  merchant_name: string | null;
  description: string | null;
  amount: number;
  account_name: string | null;
  categorization_source: string;
  budget_categories:
  | { name: string }
  | { name: string }[]
  | null;
};
type Section =
  | "dashboard"
  | "transactions"
  | "budget"
  | "accounts"
  | "settings";

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const loggedIn = userId !== null;
  const [month, setMonth] = useState(currentMonth);
  const [monthlyTransactions, setMonthlyTransactions] = useState<BudgetTransaction[]>([]);
  const [bankConnections, setBankConnections] = useState<{ id: string }[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [loadedScope, setLoadedScope] = useState("");
  const requestVersion = useRef(0);
  const currentUser = useRef<string | null>(null);
  const invalidateRequests = useCallback(() => { requestVersion.current++; }, []);
  const [syncing, setSyncing] = useState(false);
  const syncInProgress = useRef(false);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("dashboard");

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user.id ?? null;
      if (currentUser.current !== nextUser) {
        currentUser.current = nextUser;
        invalidateRequests();
        setUserId(nextUser);
        setLoadedScope("");
        setLinkToken(null);
        setMessage("");
        setCategories([]);
        setMonthlyTransactions([]);
        setTransactions([]);
        setBankConnections([]);
      }
    });
    return () => subscription.unsubscribe();
  }, [invalidateRequests]);
  const loadData = useCallback(async () => {
    if (!userId || currentUser.current !== userId) return false;
    const version = ++requestVersion.current;
    setDataLoading(true);
    setDataError("");
    try {
      const { start, end } = monthBounds(month);
     const [categoryData, monthlyData, recent, connections, monthBudgets] = await Promise.all([
        fetchAllPages<BudgetCategory>((from, to) => supabase.from("budget_categories")
          .select("id, name, monthly_limit, category_type").eq("user_id", userId)
          .eq("is_active", true).order("sort_order").order("id").range(from, to)),
        fetchAllPages<BudgetTransaction>((from, to) => supabase.from("transactions")
          .select("id, category_id, transaction_date, amount, excluded_from_budget, is_transfer, plaid_removed_at")
          .eq("user_id", userId).gte("transaction_date", start).lt("transaction_date", end)
          .order("id").range(from, to)),
        supabase.from("transactions")
          .select("id, category_id, transaction_date, merchant_name, description, amount, account_name, categorization_source, excluded_from_budget, is_transfer, plaid_removed_at, budget_categories(name)")
          .eq("user_id", userId).is("plaid_removed_at", null)
          .order("transaction_date", { ascending: false }).order("id").limit(100),
        supabase.from("bank_connections").select("id").eq("user_id", userId).eq("status", "active"),
        supabase
  .from("budget_months")
  .select("category_id,budget_amount")
  .eq("user_id", userId)
  .eq("month", `${month}-01`),
      ]);
      if (recent.error) throw recent.error;
      if (connections.error) throw connections.error;
      // Validate before publishing the complete snapshot.
      const monthlyOverrides = new Map(
  (monthBudgets.data ?? []).map((item) => [
    item.category_id,
    Number(item.budget_amount),
  ])
);

const effectiveCategories = categoryData.map((category) => ({
  ...category,
  monthly_limit:
    monthlyOverrides.get(category.id) ?? category.monthly_limit,
}));
    summarizeBudget(effectiveCategories, monthlyData, month);
      if (version !== requestVersion.current) return false;
     setCategories(effectiveCategories);
      setMonthlyTransactions(monthlyData);
      setTransactions((recent.data ?? []) as Transaction[]);
      setBankConnections(connections.data ?? []);
      setLoadedScope(userId + ":" + month);
      return true;
    } catch {
      if (version === requestVersion.current) setDataError("Could not load your budget. Refresh to try again; no partial totals are shown.");
      return false;
    } finally {
      if (version === requestVersion.current) setDataLoading(false);
    }
  }, [userId, month]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void loadData(); });
    return () => { active = false; invalidateRequests(); };
  }, [loadData, invalidateRequests]);
  async function signIn() {
    setMessage("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setMessage(error.message);
    else setPassword("");
  }
async function createPlaidLinkToken() {
  if (!userId || currentUser.current !== userId) return;
  setMessage("");

  const { data, error } = await supabase.functions.invoke(
    "plaid-create-link-token"
  );

  if (currentUser.current !== userId) return;
  if (error) {
    setMessage(`Plaid error: ${error.message}`);
    return;
  }

  if (!data?.link_token) {
    setMessage("Plaid did not return a link token.");
    return;
  }

  setLinkToken(data.link_token);
}
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) { setMessage("Could not sign out. Please try again."); return; }
    invalidateRequests();
    currentUser.current = null;
    setUserId(null);
    setMonthlyTransactions([]);
    setBankConnections([]);
    setLoadedScope("");
    setLinkToken(null);
    setCategories([]);
    setTransactions([]);
    setEmail("");
    setPassword("");
    setMessage("");
    setSection("dashboard");
  }

const { open: openPlaid, ready: plaidReady } = usePlaidLink({
  token: linkToken,

  onSuccess: async (public_token) => {
    if (!userId || currentUser.current !== userId) return;
    setMessage("Connecting bank...");

    const { error } = await supabase.functions.invoke(
      "plaid-exchange-token",
      {
        body: { public_token },
      }
    );

    if (currentUser.current !== userId) return;
    if (error) {
      setMessage(`Bank connection error: ${error.message}`);
      return;
    }

    await loadData();
    if (currentUser.current === userId) setMessage("Bank connected successfully.");
  },

  onExit: (error) => {
    if (error) {
      setMessage(
        `Plaid error: ${error.display_message || error.error_message}`
      );
    }
  },
});
  const summary = summarizeBudget(categories, monthlyTransactions, month);
  const totalBudget = summary.budget;
  const dataReady = loadedScope === userId + ":" + month && !dataLoading && !dataError;
  const money = (amount: number) => amount.toLocaleString(undefined, { style: "currency", currency: "USD" });
  function Navigation() {
    const items: { id: Section; label: string }[] = [
      { id: "dashboard", label: "Dashboard" },
      { id: "transactions", label: "Transactions" },
      { id: "budget", label: "Budget" },
      { id: "accounts", label: "Accounts" },
      { id: "settings", label: "Settings" },
    ];

    return (
      <div className="flex gap-2 overflow-x-auto pb-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setSection(item.id)}
            className={`px-4 py-2 rounded-xl whitespace-nowrap ${
              section === item.id
                ? "bg-green-500 text-white"
                : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  }

  function TransactionList() {
    if (transactions.length === 0) {
      return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 text-center">
          <p className="text-lg font-semibold">No transactions yet</p>

          <p className="text-zinc-500 mt-2">
            Your transactions will appear here after we connect Plaid.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {transactions.map((transaction) => (
          <div
            key={transaction.id}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex justify-between gap-4 items-center"
          >
            <div>
              <p className="font-semibold">
                {transaction.merchant_name ||
                  transaction.description ||
                  "Transaction"}
              </p>

              <p className="text-zinc-500 text-sm mt-1">
                {transaction.transaction_date}

           {transaction.budget_categories
  ? ` • ${
      Array.isArray(transaction.budget_categories)
        ? transaction.budget_categories[0]?.name ?? "Uncategorized"
        : transaction.budget_categories.name
    }`
  : " • Uncategorized"}

              </p>

              {transaction.account_name && (
                <p className="text-zinc-600 text-xs mt-1">
                  {transaction.account_name}
                </p>
              )}
            </div>

            <p className="font-bold text-lg whitespace-nowrap">
              $
              {Number(transaction.amount).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
        ))}
      </div>
    );
  }

  function Dashboard() {
    return (
      <>
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <p className="text-zinc-400 text-sm">Budget for Selected Month</p>

            <p className="text-3xl font-bold mt-2">
              $
              {totalBudget.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>

            <p className="text-zinc-500 text-sm mt-2">
              {categories.length} categories
            </p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <p className="text-zinc-400 text-sm">Categorized Spending</p>
            <p className="text-3xl font-bold mt-2">{money(summary.spent)}</p>
            <p className="text-zinc-500 text-sm mt-2">
              For the selected month
            </p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <p className="text-zinc-400 text-sm">Remaining</p>

            <p className="text-3xl font-bold mt-2">
              $
              {summary.remaining.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>

            <p className="text-zinc-500 text-sm mt-2">
              After categorized spending
            </p>
          </div>
        </div>

        <div className="flex justify-between items-end mb-5">
          <div>
            <h2 className="text-2xl font-bold">Budget Categories</h2>

            <p className="text-zinc-400 mt-1">
              Current category limits for the selected month
            </p>
          </div>

          <button
            onClick={() => setSection("budget")}
            className="text-green-400 hover:text-green-300"
          >
            View budget
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {categories.map((category) => (
            <div
              key={category.id}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
            >
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-semibold text-lg">{category.name}</p>

                  <p className="text-zinc-500 text-sm capitalize">
                    {category.category_type}
                  </p>
                </div>

                <p className="text-xl font-bold">
                  $
                  {Number(category.monthly_limit).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  function TransactionsPage() {
    return (
      <>
        <div className="mb-7">
          <h2 className="text-3xl font-bold">Transactions</h2>

          <p className="text-zinc-400 mt-2">
            Your 100 most recent imported transactions. Budget totals use the full selected month.
          </p>
        </div>

        {TransactionList()}
      </>
    );
  }

  function BudgetPage() {
    async function editMonthlyBudget(categoryName: string, currentAmount: number) {
  const entered = window.prompt(
    `Enter the budget for ${categoryName} for ${month}:`,
    String(currentAmount)
  );

  if (entered === null) return;

  const newAmount = Number(entered);

  if (!Number.isFinite(newAmount) || newAmount < 0) {
    window.alert("Please enter a valid budget amount.");
    return;
  }
  
  

  const { error } = await supabase.rpc("set_month_budget", {
    target_month: `${month}-01`,
    target_category: categoryName,
    new_amount: newAmount,
  });

  if (error) {
    window.alert(`Could not update budget: ${error.message}`);
    return;
  }

  await loadData();
}

async function editDefaultBudget(categoryName: string, currentAmount: number) {
  const entered = window.prompt(
    `Enter the normal monthly budget for ${categoryName}:`,
    String(currentAmount)
  );

  if (entered === null) return;

  const newAmount = Number(entered);

  if (!Number.isFinite(newAmount) || newAmount < 0) {
    window.alert("Please enter a valid budget amount.");
    return;
  }

  const confirmed = window.confirm(
    `Change ${categoryName} to ${money(newAmount)} going forward?\n\nThis will not change previous months.`
  );

  if (!confirmed) return;

  const { error } = await supabase.rpc("set_default_budget", {
    target_category: categoryName,
    new_amount: newAmount,
    effective_date: `${month}-01`,
  });

  if (error) {
    window.alert(`Could not update default budget: ${error.message}`);
    return;
  }

  await loadData();
}
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
  onClick={() => editMonthlyBudget(category.name, category.limit)}
  className="mt-2 text-sm text-green-400 hover:text-green-300"
>
  Edit budget
</button>
<button
  onClick={() => editDefaultBudget(category.name, category.limit)}
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
async function syncTransactions() {
  if (syncInProgress.current || !userId) return;
  const sameUser = () => currentUser.current === userId;
  syncInProgress.current = true;
  setSyncing(true);
  setMessage("Syncing transactions...");
  try {
    const { data: syncData, error: syncError } = await supabase.functions.invoke("plaid-sync-transactions", { body: {} });
    if (!sameUser()) return;
    if (syncError || syncData?.success === false || syncData?.error) {
      await loadData();
      if (!sameUser()) return;
      setMessage("Some accounts could not sync. Please retry. Successfully imported transactions have been refreshed.");
      return;
    }
    setMessage("Transactions synced. AI categorizing...");
    const { data: aiData, error: aiError } = await supabase.functions.invoke("ai-categorize-transactions", { body: {} });
    if (!sameUser()) return;
    await loadData();
    if (!sameUser()) return;
    if (aiError || aiData?.error) {
      setMessage("Transactions synced, but AI categorization could not finish. Your latest transactions have been refreshed; retry sync to finish categorizing.");
      return;
    }
    setMessage("Sync complete. AI categorized " + (aiData?.processed ?? 0) + " transactions.");
  } catch {
    if (!sameUser()) return;
    await loadData();
    if (!sameUser()) return;
    setMessage("Sync could not finish. Please try again.");
  } finally {
    syncInProgress.current = false;
    setSyncing(false);
  }
}
function AccountsPage() {
  return (
    <>
      <div className="mb-7">
        <h2 className="text-3xl font-bold">Accounts</h2>
        <p className="text-zinc-400 mt-2">
          Connect your bank and credit card accounts.
        </p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <h3 className="text-xl font-bold">Bank Connections</h3>

        <p className="text-zinc-400 mt-2 mb-6">
          Securely connect your accounts through Plaid.
        </p>
        {bankConnections.length > 0 && (
  <div className="mb-6 rounded-xl border border-green-800 bg-green-950/30 p-4">
    <p className="font-semibold text-green-400">✓ Bank connected</p>
    <p className="text-sm text-zinc-400 mt-1">
      {bankConnections.length} active connection{bankConnections.length !== 1 ? "s" : ""}
    </p>
  </div>
)}

        <button
          onClick={() => {
            if (!linkToken) {
              createPlaidLinkToken();
            } else {
              openPlaid();
            }
          }}
          disabled={linkToken !== null && !plaidReady}
          className="bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl"
        >
          {linkToken ? "Continue Connecting" : "Connect Bank"}
        </button>
      {bankConnections.length > 0 && (
  <>
    <button
      onClick={syncTransactions}
      disabled={syncing}
      className="ml-3 bg-zinc-700 hover:bg-zinc-600 text-white font-semibold px-6 py-3 rounded-xl"
    >
      {syncing ? "Syncing..." : "Sync Transactions"}
    </button>

    
  </>
)}
      </div>
    </>
  );
}
  function ComingSoon({ title }: { title: string }) {
    return (
      <div>
        <h2 className="text-3xl font-bold">{title}</h2>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 mt-7 text-center">
          <p className="text-zinc-400">
            We&apos;ll build this section next.
          </p>
        </div>
      </div>
    );
  }

  if (loggedIn) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white">
        <header className="border-b border-zinc-800">
          <div className="max-w-6xl mx-auto px-6 py-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <p className="text-green-400 font-semibold text-sm">
                  BUDGET LIVE
                </p>

                <h1 className="text-2xl font-bold">Your Money</h1>
              </div>

              <button
                onClick={signOut}
                disabled={syncing}
                className="border border-zinc-700 px-4 py-2 rounded-xl hover:bg-zinc-800"
              >
                Sign out
              </button>
            </div>

            {Navigation()}
          </div>
        </header>

        <div className="max-w-6xl mx-auto p-6 md:p-10">
          {message && (
            <div className="bg-red-950 border border-red-900 text-red-300 rounded-xl p-4 mb-6">
              {message}
            </div>
          )}

         <div className="flex flex-wrap items-center gap-3 mb-6">
  <span className="font-medium">
    Budget month: {new Date(`${month}-02`).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    })}
  </span>

  <button
    onClick={() => {
      const [year, monthNumber] = month.split("-").map(Number);
      const date = new Date(year, monthNumber - 2, 1);
      setMonth(
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
      );
    }}
    disabled={syncing}
    className="rounded-lg border border-zinc-700 px-3 py-2 disabled:opacity-50"
  >
    ← Previous
  </button>

  <button
    onClick={() => {
      const [year, monthNumber] = month.split("-").map(Number);
      const date = new Date(year, monthNumber, 1);
      setMonth(
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
      );
    }}
    disabled={syncing}
    className="rounded-lg border border-zinc-700 px-3 py-2 disabled:opacity-50"
  >
    Next →
  </button>

  <button
    onClick={() => void loadData()}
    disabled={dataLoading || syncing}
    className="rounded-lg border border-zinc-700 p-2 disabled:opacity-50"
  >
    Refresh
  </button>
</div>
          {dataError ? <p role="alert" className="text-red-300 mb-6">{dataError}</p> : !dataReady && <p role="status">Loading your budget...</p>}
          {dataReady && (section === "dashboard" || section === "budget") && summary.unassignedCount > 0 && <p className="rounded-xl border border-amber-800 p-4 mb-6 text-amber-200">{summary.unassignedCount} transactions totaling {money(summary.unassigned)} have no active budget category. These are not included in categorized spending or remaining amounts.</p>}
          {dataReady && section === "dashboard" && Dashboard()}

          {dataReady && section === "transactions" && TransactionsPage()}

          {dataReady && section === "budget" && BudgetPage()}

          {dataReady && section === "accounts" && AccountsPage()}

          {section === "settings" && ComingSoon({ title: "Settings" })}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl">
        <p className="text-green-600 font-semibold text-sm">BUDGET LIVE</p>

        <h1 className="text-3xl font-bold text-zinc-900 mt-2">
          Welcome back
        </h1>

        <p className="text-zinc-500 mt-2 mb-8">
          Sign in to view your finances.
        </p>

        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-zinc-300 rounded-xl p-3 mb-3 text-zinc-900"
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-zinc-300 rounded-xl p-3 mb-4 text-zinc-900"
        />

        <button
          onClick={signIn}
          disabled={loading}
          className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-semibold rounded-xl p-3"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        {message && (
          <p className="text-red-600 text-sm mt-4 text-center">{message}</p>
        )}

        <p className="text-zinc-400 text-xs text-center mt-7">
          Your financial data stays private and secure.
        </p>
      </div>
    </main>
  );
}