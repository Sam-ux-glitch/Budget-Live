"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { usePlaidLink } from "react-plaid-link";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
);

type BudgetCategory = {
  id: string;
  name: string;
  monthly_limit: number;
  category_type: string;
};

type Transaction = {
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
  const [loggedIn, setLoggedIn] = useState(false);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("dashboard");

  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      setLoggedIn(true);
      await loadData();
    }
  }

  async function signIn() {
    setMessage("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setLoggedIn(true);
    await loadData();
  }

  async function loadData() {
    setMessage("");

    const { data: categoryData, error: categoryError } = await supabase
      .from("budget_categories")
      .select("id, name, monthly_limit, category_type")
      .eq("is_active", true)
      .order("sort_order");

    if (categoryError) {
      setMessage(categoryError.message);
      return;
    }

    setCategories(categoryData ?? []);

    const { data: transactionData, error: transactionError } = await supabase
      .from("transactions")
      .select(`
        id,
        transaction_date,
        merchant_name,
        description,
        amount,
        account_name,
        categorization_source,
        budget_categories (
          name
        )
      `)
      .order("transaction_date", { ascending: false })
      .limit(100);

    if (transactionError) {
      setMessage(transactionError.message);
      return;
    }
console.log("TRANSACTION DATA:", transactionData);
    setTransactions((transactionData ?? []) as Transaction[]);
  }
async function createPlaidLinkToken() {
  setMessage("");

  const { data, error } = await supabase.functions.invoke(
    "plaid-create-link-token"
  );

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
    await supabase.auth.signOut();

    setLoggedIn(false);
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
    setMessage("Connecting bank...");

    const { data, error } = await supabase.functions.invoke(
      "plaid-exchange-token",
      {
        body: { public_token },
      }
    );

    if (error) {
      setMessage(`Bank connection error: ${error.message}`);
      return;
    }

    console.log("Plaid token exchange successful", data);
    setMessage("Bank connected successfully.");
  },

  onExit: (error) => {
    if (error) {
      setMessage(
        `Plaid error: ${error.display_message || error.error_message}`
      );
    }
  },
});
  const totalBudget = categories.reduce(
    (total, category) => total + Number(category.monthly_limit),
    0
  );

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
            <p className="text-zinc-400 text-sm">Monthly Budget</p>

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
            <p className="text-zinc-400 text-sm">Spent This Month</p>
            <p className="text-3xl font-bold mt-2">$0.00</p>
            <p className="text-zinc-500 text-sm mt-2">
              Updates from transactions
            </p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <p className="text-zinc-400 text-sm">Remaining</p>

            <p className="text-3xl font-bold mt-2">
              $
              {totalBudget.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>

            <p className="text-zinc-500 text-sm mt-2">
              Available this month
            </p>
          </div>
        </div>

        <div className="flex justify-between items-end mb-5">
          <div>
            <h2 className="text-2xl font-bold">Budget Categories</h2>

            <p className="text-zinc-400 mt-1">
              Your monthly spending limits
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
            View and manage your imported transactions.
          </p>
        </div>

        <TransactionList />
      </>
    );
  }

  function BudgetPage() {
    return (
      <>
        <div className="mb-7">
          <h2 className="text-3xl font-bold">Budget</h2>

          <p className="text-zinc-400 mt-2">
            Your monthly budget categories.
          </p>
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
function AccountsPage() {
  const [bankConnections, setBankConnections] = useState<any[]>([]);
  useEffect(() => {
  async function loadBankConnections() {
    const { data, error } = await supabase
      .from("bank_connections")
      .select("*")
      .eq("status", "active");

    if (!error) {
      setBankConnections(data ?? []);
    }
  }

  loadBankConnections();
}, []);
async function syncTransactions() {
  setMessage("Syncing transactions...");

  const { data: syncData, error: syncError } =
    await supabase.functions.invoke("plaid-sync-transactions", {
      body: {},
    });

  if (syncError) {
    setMessage(`Sync error: ${syncError.message}`);
    return;
  }

  console.log("Plaid sync result:", syncData);
  setMessage("Transactions synced. AI categorizing...");

  const { data: aiData, error: aiError } =
    await supabase.functions.invoke("ai-categorize-transactions", {
      body: {},
    });

  if (aiError) {
    setMessage(`AI categorization error: ${aiError.message}`);
    return;
  }

  console.log("AI categorization result:", aiData);
  setMessage(
    `Sync complete. AI categorized ${aiData?.processed ?? 0} transactions.`
  );
}


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
      className="ml-3 bg-zinc-700 hover:bg-zinc-600 text-white font-semibold px-6 py-3 rounded-xl"
    >
      Sync Transactions
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
                className="border border-zinc-700 px-4 py-2 rounded-xl hover:bg-zinc-800"
              >
                Sign out
              </button>
            </div>

            <Navigation />
          </div>
        </header>

        <div className="max-w-6xl mx-auto p-6 md:p-10">
          {message && (
            <div className="bg-red-950 border border-red-900 text-red-300 rounded-xl p-4 mb-6">
              {message}
            </div>
          )}

          {section === "dashboard" && <Dashboard />}

          {section === "transactions" && <TransactionsPage />}

          {section === "budget" && <BudgetPage />}

          {section === "accounts" && <AccountsPage />}

          {section === "settings" && <ComingSoon title="Settings" />}
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