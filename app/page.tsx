"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { currentMonth, monthBounds, summarizeBudget, fetchAllPages, type BudgetCategory, type BudgetTransaction } from "./lib/budget";
import { buildSavingsPlan, type SavingsInputs } from "./lib/savings";
import BudgetPage from "./components/BudgetPage";
import SavingsPlanner from "./components/SavingsPlanner";
import BudgetCoach from "./components/BudgetCoach";
import ConnectionList from "./components/ConnectionList";
import SettingsPage, {PasswordForm} from "./components/SettingsPage";
import {App} from "@capacitor/app";
import {nativeIOS, BudgetNative, setWidgetUser, refreshWidget} from "./lib/native";
import { createClient } from "@supabase/supabase-js";
import { usePlaidLink } from "react-plaid-link";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  {auth:{flowType:"pkce"}}
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
  | "savings"
  | "coach"
  | "accounts"
  | "settings";

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [recovery,setRecovery]=useState(false);
  const [defaults,setDefaults]=useState<Record<string,number>>({});
  const [budgetSaving,setBudgetSaving]=useState(false);
  const budgetWrite=useRef(false);
  const recoveryUrl=useRef("");
  const [userId, setUserId] = useState<string | null>(null);
  const loggedIn = userId !== null;
  const [month, setMonth] = useState(currentMonth);
  const [monthlyTransactions, setMonthlyTransactions] = useState<BudgetTransaction[]>([]);
  const [bankConnections, setBankConnections] = useState<{ id: string; institution_name?: string|null; status?: string }[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [loadedScope, setLoadedScope] = useState("");
  const requestVersion = useRef(0);
  const currentUser = useRef<string | null>(null);
  const invalidateRequests = useCallback(() => { requestVersion.current++; }, []);
  const [syncing, setSyncing] = useState(false);
  const syncInProgress = useRef(false);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [cashflow, setCashflow] = useState<SavingsInputs | null>(null);
  const [savingSavings, setSavingSavings] = useState(false);
  const savingsWrite = useRef(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("dashboard");

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === "PASSWORD_RECOVERY") setRecovery(true);
      const nextUser = session?.user.id ?? null;
      if (currentUser.current !== nextUser) {
        currentUser.current = nextUser;
        void setWidgetUser(nextUser).catch(()=>setMessage("Widget could not be cleared. Reopen the app before sharing this device."));
        invalidateRequests();
        setUserId(nextUser);
        setLoadedScope("");
        setLinkToken(null);
        setMessage("");
        setCategories([]);
        setCashflow(null);
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
      const { error: budgetMonthError } = await supabase.rpc("create_month_budget", {
  target_month: `${month}-01`,
});

if (budgetMonthError) {
  throw budgetMonthError;
}
      const { error: incomeError } = await supabase.rpc("create_month_income", {
  target_month: `${month}-01`,
});

if (incomeError) {
  throw incomeError;
}
      const { start, end } = monthBounds(month);
const [categoryData, monthlyData, recent, connections, monthBudgets, cashflowData, paycheckData, settingsData, savingsOverrideData] = await Promise.all([
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
        supabase.from("bank_connections").select("id,institution_name,status").eq("user_id", userId),
        supabase
  .from("budget_months")
  .select("category_id,budget_amount")
  .eq("user_id", userId)
  .eq("month", `${month}-01`),
 supabase
  .from("monthly_savings_summary")
  .select("expected_income,projected_surplus,monthly_savings_goal")
  .eq("user_id", userId)
  .eq("month", `${month}-01`)
  .maybeSingle(),
 
supabase.rpc("expected_paychecks_for_month", {
  target_month: `${month}-01`,
}),
     supabase
  .from("settings")
  .select("savings_per_paycheck")
  .eq("user_id", userId)
 .maybeSingle(),
   supabase
  .from("monthly_savings_overrides")
  .select("savings_target_override")
  .eq("user_id", userId)
  .eq("month", `${month}-01`)
  .maybeSingle(),
  ]);
      if (monthBudgets.error) throw monthBudgets.error;
      if (recent.error) throw recent.error;
      if (connections.error) throw connections.error;
      if (cashflowData.error) throw cashflowData.error;
      if (paycheckData.error) throw paycheckData.error;
      if (settingsData.error) throw settingsData.error;
      if (savingsOverrideData.error) throw savingsOverrideData.error;
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
      const savingsInputs: SavingsInputs = {
        month,
        expectedIncome: cashflowData.data?.expected_income ?? null,
        paycheckCount: paycheckData.data?.length ?? 0,
        savingsPerPaycheck: settingsData.data?.savings_per_paycheck ?? null,
        monthlyOverride: savingsOverrideData.data?.savings_target_override ?? null,
      };
      buildSavingsPlan(savingsInputs, summarizeBudget(effectiveCategories, monthlyData, month));
      if (version !== requestVersion.current) return false;
      setDefaults(Object.fromEntries(categoryData.map(c=>[c.id,Number(c.monthly_limit)])));
      setCategories(effectiveCategories);
      void refreshWidget(supabase,userId).catch(()=>setMessage("Budget refreshed. Widget could not update; open the app to retry."));
      setCashflow(savingsInputs);
      setMonthlyTransactions(monthlyData);
      setTransactions((recent.data ?? []) as Transaction[]);
      setBankConnections(connections.data ?? []);
      setLoadedScope(userId + ":" + month);
      return true;
  } catch (error) {
   if (version === requestVersion.current) setDataError(`Could not load your budget: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
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
  useEffect(()=>{
    if(!nativeIOS())return;
    let active=true;
    const handle=async(url:string)=>{
      try {const parsed=new URL(url);if(parsed.protocol!=="budgetlive:")return;
      if(parsed.host==="budget"){setMonth(currentMonth());setSection("budget");return;}
      if(parsed.host!=="auth"||parsed.pathname!=="/recovery")return;
      if(recoveryUrl.current===url)return;
      const code=parsed.searchParams.get("code");
      if(!code)return;
      recoveryUrl.current=url;
      const {error}=await supabase.auth.exchangeCodeForSession(code);
      if(active){if(error)setMessage("Recovery link expired. Request a new link.");else setRecovery(true);}
      }catch{if(active)setMessage("Recovery link could not be opened.");}
    };
    const listener=App.addListener("appUrlOpen",event=>{void handle(event.url);});
    void App.getLaunchUrl().then(result=>{if(result)void handle(result.url);});
    return()=>{active=false;void listener.then(h=>h.remove());};
  },[]);
  useEffect(()=>{
    if(!nativeIOS())return;
    const foreground=App.addListener("appStateChange",event=>{if(event.isActive&&currentUser.current)void loadData();});
    return()=>{void foreground.then(h=>h.remove());};
  },[loadData]);
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
    "plaid-create-link-token", {body:{platform:nativeIOS()?"ios":"web"}}
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

  if(nativeIOS()){
    try {const result=await BudgetNative.openPlaid({token:data.link_token});
      if(currentUser.current!==userId)return;
      const {error:exchangeError}=await supabase.functions.invoke("plaid-exchange-token",{body:{public_token:result.publicToken}});
      if(exchangeError)throw new Error("Bank connection could not finish. Please retry.");
      await loadData();setMessage("Bank connected successfully.");
    }catch{setMessage("Bank connection canceled or unavailable. Please retry.");}
  }else setLinkToken(data.link_token);
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
        setCashflow(null);
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

    setLinkToken(null);
    await loadData();
    if (currentUser.current === userId) setMessage("Bank connected successfully.");
  },

  onExit: (error) => {
    setLinkToken(null);
    if (error) {
      setMessage(
        `Plaid error: ${error.display_message || error.error_message}`
      );
    }
  },
});
  const summary = summarizeBudget(categories, monthlyTransactions, month);
  const savingsPlan = cashflow ? buildSavingsPlan(cashflow, summary) : null;
  const totalBudget = summary.budget;
  const dataReady = loadedScope === userId + ":" + month && !dataLoading && !dataError;
  const money = (amount: number) => amount.toLocaleString(undefined, { style: "currency", currency: "USD" });
  function Navigation() {
    const items: { id: Section; label: string }[] = [
      { id: "dashboard", label: "Dashboard" },
      { id: "transactions", label: "Transactions" },
      { id: "budget", label: "Budget" },
      { id: "savings", label: "Savings" },
      { id: "coach", label: "AI Coach" },
      { id: "accounts", label: "Accounts" },
      { id: "settings", label: "Settings" },
    ];

    return (
<div className="grid grid-cols-2 gap-2 sm:flex sm:overflow-x-auto pb-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setSection(item.id)}
            disabled={savingSavings}
className={`w-full px-3 py-2 rounded-xl text-sm whitespace-nowrap sm:w-auto sm:px-4 ${
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

   async function changeTransactionCategory(
  transactionId: string,
  categoryName: string
) {
  const category = categories.find(
    (item) => item.name === categoryName
  );

  if (!category) {
    window.alert("Category not found.");
    return;
  }

  const { error } = await supabase.rpc("confirm_transaction_category", {
   target_transaction: transactionId,
target_category: category.id,
  });
  if (!error) {
  const { error: memoryError } = await supabase.rpc(
    "remember_merchant_category",
    {
      target_transaction: transactionId,
      target_category: category.id,
    }
  );

  if (memoryError) {
    window.alert(
      `Category changed, but merchant memory failed: ${memoryError.message}`
    );
  }
}

  if (error) {
    window.alert(`Could not change category: ${error.message}`);
    return;
  }

  await loadData();
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
              <select
  value={
    transaction.budget_categories
      ? Array.isArray(transaction.budget_categories)
        ? transaction.budget_categories[0]?.name ?? ""
        : transaction.budget_categories.name
      : ""
  }
  onChange={(event) =>
    void changeTransactionCategory(transaction.id, event.target.value)
  }
  className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
>
  <option value="" disabled>
    Choose category
  </option>

  {categories.map((category) => (
    <option key={category.id} value={category.name}>
      {category.name}
    </option>
  ))}
</select>

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
        {savingsPlan && (
  <div className="grid gap-4 md:grid-cols-4 mb-8">
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5">
      <p className="text-zinc-400 text-sm">Expected Income</p>
      <p className="text-2xl font-bold">{savingsPlan.expectedIncome === null ? "Not available" : money(savingsPlan.expectedIncome)}</p>
    </div>

    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5">
      <p className="text-zinc-400 text-sm">Monthly Budget</p>
      <p className="text-2xl font-bold">{money(summary.budget)}</p>
    </div>

    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5">
      <p className="text-zinc-400 text-sm">Projected Left Over</p>
      <p className="text-2xl font-bold">{savingsPlan.projectedSurplus === null ? "Not available" : money(savingsPlan.projectedSurplus)}</p>
    </div>

    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5">
      <p className="text-zinc-400 text-sm">Savings Goal</p>
      <p className="text-2xl font-bold">{savingsPlan.target === null ? "Not configured" : money(savingsPlan.target)}</p>
    </div>
  </div>
)}

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
  async function updateSavingsTarget(amount: number | null) {
    if (!userId || currentUser.current !== userId || savingsWrite.current || !dataReady) {
      throw new Error("Please wait for your budget to load and try again.");
    }
    const version = requestVersion.current;
    savingsWrite.current = true;
    setSavingSavings(true);
    try {
      if (amount === null) {
        const { data, error } = await supabase.from("monthly_savings_overrides")
          .delete().eq("user_id", userId).eq("month", month + "-01")
          .select("month");
        if (error) throw new Error("Could not reset your target: " + error.message);
        if (!data?.length) throw new Error("Reset was not confirmed. Refresh and retry; if it persists, check the savings reset database policy.");
      } else {
        const { error } = await supabase.from("monthly_savings_overrides").upsert({
          user_id: userId, month: month + "-01", savings_target_override: amount,
        }, {onConflict: "user_id,month"});
        if (error) throw new Error("Could not update your target: " + error.message);
      }
      // A late response must never reload a previous month or another user's data.
      if (currentUser.current === userId && requestVersion.current === version) await loadData();
    } finally {
      savingsWrite.current = false;
      setSavingSavings(false);
    }
  }
  async function saveBudget(categoryName: string, amount: number, isDefault: boolean) {
    if (!userId || currentUser.current !== userId || budgetWrite.current || !dataReady) throw new Error("Please refresh and retry.");
    budgetWrite.current=true;setBudgetSaving(true);
    try {
      const today=new Date();const nextMonth=new Date(today.getFullYear(),today.getMonth()+1,1);
      const effectiveDate=nextMonth.getFullYear()+"-"+String(nextMonth.getMonth()+1).padStart(2,"0")+"-01";
      const {error}=await supabase.rpc(isDefault?"set_default_budget":"set_month_budget",isDefault?{target_category:categoryName,new_amount:amount,effective_date:effectiveDate}:{target_category:categoryName,new_amount:amount,target_month:month+"-01"});
      if(error)throw new Error("Could not save budget. "+error.message);
      if(currentUser.current===userId)await loadData();
    }finally{budgetWrite.current=false;setBudgetSaving(false);}
  }
  const editMonthlyBudget=(name:string,amount:number)=>saveBudget(name,amount,false);
  const editDefaultBudget=(name:string,amount:number)=>saveBudget(name,amount,true);
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
        <ConnectionList connections={bankConnections} supabase={supabase} onRefresh={loadData}/>
        {bankConnections.some(c=>!c.status||c.status==="active") && (
  <div className="mb-6 rounded-xl border border-green-800 bg-green-950/30 p-4">
    <p className="font-semibold text-green-400">✓ Bank connected</p>
    <p className="text-sm text-zinc-400 mt-1">
      {bankConnections.filter(connection => connection.status === "active").length} active connection{bankConnections.filter(connection => connection.status === "active").length !== 1 ? "s" : ""}
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
      {bankConnections.some(c=>!c.status||c.status==="active") && (
  <>
    <button
      onClick={syncTransactions}
      disabled={syncing || savingSavings || budgetSaving}
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
  if (recovery && loggedIn) return <main className="min-h-screen bg-zinc-950 text-white p-6"><section className="max-w-md mx-auto space-y-5"><h1 className="text-2xl font-bold">Reset password</h1><PasswordForm supabase={supabase} onComplete={()=>{setRecovery(false);setMessage("Password changed.");}}/><button onClick={()=>void signOut().then(()=>setRecovery(false))}>Cancel and sign out</button></section></main>;
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
                disabled={syncing || savingSavings || budgetSaving}
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

<div className="mb-6">
  <div className="mb-3">
    <p className="text-sm text-zinc-500">Budget month selection</p>

    <p className="mt-1 font-medium">
      {new Date(`${month}-02`).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })}
    </p>
  </div>

  <div className="flex flex-wrap gap-3">
    <button
      onClick={() => {
        const [year, monthNumber] = month.split("-").map(Number);
        const date = new Date(year, monthNumber - 2, 1);
        setMonth(
          `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
        );
      }}
      disabled={syncing || savingSavings || budgetSaving}
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
      disabled={syncing || savingSavings || budgetSaving}
      className="rounded-lg border border-zinc-700 px-3 py-2 disabled:opacity-50"
    >
      Next →
    </button>

    <button
      onClick={() => void loadData()}
      disabled={dataLoading || syncing || savingSavings || budgetSaving}
      className="rounded-lg border border-zinc-700 px-3 py-2 disabled:opacity-50"
    >
      Refresh
    </button>
  </div>
</div>
          {dataError ? <p role="alert" className="text-red-300 mb-6">{dataError}</p> : !dataReady && <p role="status">Loading your budget...</p>}
          {dataReady && (section === "dashboard" || section === "budget") && summary.unassignedCount > 0 && <p className="rounded-xl border border-amber-800 p-4 mb-6 text-amber-200">{summary.unassignedCount} transactions totaling {money(summary.unassigned)} have no active budget category. These are not included in categorized spending or remaining amounts.</p>}
          {dataReady && section === "dashboard" && Dashboard()}

          {dataReady && section === "transactions" && TransactionsPage()}

          {dataReady && section === "budget" && <BudgetPage key={userId+":"+month} month={month} defaults={defaults} summary={summary} editMonthlyBudget={editMonthlyBudget} editDefaultBudget={editDefaultBudget} />}
{dataReady && section === "savings" && savingsPlan && <SavingsPlanner key={userId + ":" + month} plan={savingsPlan} saving={savingSavings} onUpdate={updateSavingsTarget} onViewBudget={() => setSection("budget")} />}

          {dataReady && section === "coach" && userId && <BudgetCoach key={userId + ":" + month} month={month} userId={userId} supabase={supabase} onApplied={async()=>{setMessage("Approved change applied. Refreshing your budget.");await loadData();}} />}

          {dataReady && section === "accounts" && AccountsPage()}

          {section === "settings" && userId && <SettingsPage key={userId} supabase={supabase} userId={userId} categories={categories}/> }
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

        <button disabled={loading} className="block w-full text-green-700 py-3" onClick={async()=>{
          if(!email.trim()){setMessage("Enter your email address first.");return;}
          setLoading(true);
          const redirectTo=nativeIOS()?"budgetlive://auth/recovery":window.location.origin+"/";
          const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo});
          setLoading(false);setMessage(error?"Could not send a recovery link. Try again shortly.":"If an account exists, a recovery link has been sent. Open it on this device.");
        }}>Forgot password?</button>
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