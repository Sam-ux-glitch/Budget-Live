import { summarizeBudget, currentMonth, type BudgetCategory, type BudgetTransaction } from './budget.ts';
export const DEFAULT_WIDGET_CATEGORIES = ['Dining & Coffee', 'Entertainment', 'Gas'];
export type WidgetSnapshot = { version: 1; month: string; updatedAt: string; categories: { name: string; budget: number; spent: number; remaining: number; progress: number }[] };
export function widgetSnapshot(categories: BudgetCategory[], transactions: BudgetTransaction[], month: string, selected: string[], now = new Date()): WidgetSnapshot {
  if (month !== currentMonth(now)) throw new Error('Widget requires the current month');
  const rows = summarizeBudget(categories, transactions, month).rows;
  return { version: 1, month, updatedAt: now.toISOString(), categories: selected.slice(0, 3).flatMap(name => {
    const row = rows.find(c => c.name.toLowerCase() === name.toLowerCase());
    return row ? [{name: row.name, budget: row.limit, spent: row.spent, remaining: row.remaining,
      progress: row.limit > 0 ? Math.max(0, Math.min(1, row.remaining / row.limit)) : 0}] : [];
  }) };
}
export function widgetSelection(userId: string): string[] {
  try { const value = JSON.parse(localStorage.getItem('budget-live-widget:' + userId) ?? 'null');
    if (Array.isArray(value) && value.length <= 3 && value.every(v => typeof v === 'string' && v.length <= 100)) return value;
  } catch { /* Use safe defaults for an invalid preference. */ }
  return DEFAULT_WIDGET_CATEGORIES;
}
