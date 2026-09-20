import type { summarizeBudget } from "./budget";

type Amount = number | string;
export type SavingsInputs = {
  month: string;
  expectedIncome: Amount | null;
  paycheckCount: number;
  savingsPerPaycheck: Amount | null;
  monthlyOverride: Amount | null;
};

function cents(value: Amount): number {
  if ((typeof value === "string" && !value.trim()) || !Number.isFinite(Number(value))) {
    throw new Error("Invalid savings amount.");
  }
  const result = Math.round((Number(value) + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(result)) throw new Error("Savings amount is too large.");
  return result;
}

export function parseSavingsTarget(input: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(input.trim())) {
    throw new Error("Enter a non-negative amount with up to two decimal places.");
  }
  return cents(input.trim()) / 100;
}

// Shared, serializable facts for the UI and a future read-only Budget Coach.
// Category remaining amounts are unspent allocations, not money automatically free to move.
export function buildSavingsPlan(inputs: SavingsInputs, budget: ReturnType<typeof summarizeBudget>) {
  if (!Number.isSafeInteger(inputs.paycheckCount) || inputs.paycheckCount < 0) {
    throw new Error("Invalid paycheck count.");
  }
  const perPaycheck = inputs.savingsPerPaycheck === null ? null : cents(inputs.savingsPerPaycheck);
  const override = inputs.monthlyOverride === null ? null : cents(inputs.monthlyOverride);
  if ((perPaycheck !== null && perPaycheck < 0) || (override !== null && override < 0)) {
    throw new Error("Savings targets cannot be negative.");
  }
  const automatic = perPaycheck === null ? null : perPaycheck * inputs.paycheckCount;
  if (automatic !== null && !Number.isSafeInteger(automatic)) throw new Error("Savings amount is too large.");
  const target = override ?? automatic;
  const income = inputs.expectedIncome === null ? null : cents(inputs.expectedIncome);
  const planned = cents(budget.budget);
  const surplus = income === null ? null : income - planned;
  const headroom = surplus === null || target === null ? null : surplus - target;
  const categories = budget.rows.map(row => ({
    id: row.id, name: row.name, categoryType: row.category_type,
    planned: row.limit, spent: row.spent, remaining: row.remaining,
    overBudget: Math.max(0, -cents(row.remaining)) / 100,
  }));
  return {
    schemaVersion: 1 as const,
    month: inputs.month,
    paycheckCount: inputs.paycheckCount,
    savingsPerPaycheck: perPaycheck === null ? null : perPaycheck / 100,
    automaticTarget: automatic === null ? null : automatic / 100,
    target: target === null ? null : target / 100,
    targetSource: override === null ? "automatic" as const : "monthly_override" as const,
    expectedIncome: income === null ? null : income / 100,
    plannedSpending: planned / 100,
    projectedSurplus: surplus === null ? null : surplus / 100,
    headroom: headroom === null ? null : headroom / 100,
    shortfall: headroom === null ? null : Math.max(0, -headroom) / 100,
    status: headroom === null ? "unavailable" as const : headroom >= 0 ? "supported" as const : "shortfall" as const,
    actualSpending: budget.spent,
    categoryOverspending: categories.reduce((total, row) => total + cents(row.overBudget), 0) / 100,
    unassignedSpending: budget.unassigned,
    unassignedCount: budget.unassignedCount,
    categories,
  };
}
export type SavingsPlan = ReturnType<typeof buildSavingsPlan>;
