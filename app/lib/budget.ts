export type BudgetCategory = {
  id: string; name: string; monthly_limit: number | string; category_type: string;
};
export type BudgetTransaction = {
  id: string; category_id: string | null; transaction_date: string;
  amount: number | string; excluded_from_budget: boolean | null;
  is_transfer: boolean | null; plaid_removed_at: string | null;
};
export function currentMonth(date = new Date()) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}
export function monthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a valid month.');
  const [year, value] = month.split('-').map(Number);
  return { start: month + '-01', end: (value === 12 ? year + 1 : year) + '-' + String(value === 12 ? 1 : value + 1).padStart(2, '0') + '-01' };
}
function cents(value: number | string) {
  const number = Number(value);
  if (!Number.isFinite(number) || (typeof value === 'string' && !value.trim())) throw new Error('Invalid budget amount.');
  return Math.sign(number) * Math.round((Math.abs(number) + Number.EPSILON) * 100);
}
export function summarizeBudget(categories: BudgetCategory[], transactions: BudgetTransaction[], month: string) {
  const { start, end } = monthBounds(month);
  const spending = new Map(categories.map(category => [category.id, 0]));
  let unassignedCents = 0;
  let unassignedCount = 0;
  for (const transaction of transactions) {
    if (transaction.transaction_date < start || transaction.transaction_date >= end ||
        transaction.excluded_from_budget || transaction.is_transfer || transaction.plaid_removed_at) continue;
    const amount = cents(transaction.amount);
    if (transaction.category_id && spending.has(transaction.category_id)) {
      spending.set(transaction.category_id, spending.get(transaction.category_id)! + amount);
    } else {
      unassignedCents += amount;
      unassignedCount++;
    }
  }
  const rows = categories.map(category => {
    const limitCents = cents(category.monthly_limit);
    const spentCents = spending.get(category.id)!;
    return { ...category, limit: limitCents / 100, spent: spentCents / 100,
      remaining: (limitCents - spentCents) / 100 };
  });
  const budgetCents = categories.reduce((total, category) => total + cents(category.monthly_limit), 0);
  const spentCents = [...spending.values()].reduce((total, amount) => total + amount, 0);
  return { rows, budget: budgetCents / 100, spent: spentCents / 100,
    remaining: (budgetCents - spentCents) / 100, unassigned: unassignedCents / 100, unassignedCount };
}
// Advance by actual rows returned, even when the server caps a page below the requested size.
// A failed page rejects the entire load instead of publishing incomplete totals.
export async function fetchAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null;
}>, pageSize = 500): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await fetchPage(rows.length, rows.length + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Budget data was unavailable. Please refresh.');
    if (!data.length) return rows;
    rows.push(...data);
  }
}
