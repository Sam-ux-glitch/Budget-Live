import { Capacitor, registerPlugin } from '@capacitor/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { currentMonth, monthBounds, fetchAllPages, type BudgetCategory, type BudgetTransaction } from './budget';
import { widgetSelection, widgetSnapshot, type WidgetSnapshot } from './widget';
export const nativeIOS = () => Capacitor.getPlatform() === 'ios';
export const BudgetNative = registerPlugin<{
  beginSession(options: {scope: string}): Promise<void>;
  publish(options: {scope: string; snapshot: WidgetSnapshot}): Promise<void>;
  openPlaid(options: {token: string}): Promise<{publicToken: string}>;
}>('BudgetNative');
let scope = '';
let epoch = 0;
let widgetRequest = 0;
export async function setWidgetUser(user: string | null) {
  epoch++; widgetRequest++; scope = user ? user + ':' + epoch : '';
  if (nativeIOS()) await BudgetNative.beginSession({scope});
}
export async function refreshWidget(client: SupabaseClient, userId: string) {
  if (!nativeIOS() || !scope.startsWith(userId + ':')) return;
  const requestScope = scope;
  const requestVersion = ++widgetRequest;
  const month = currentMonth(); const {start, end} = monthBounds(month);
  const {error: initError} = await client.rpc('create_month_budget', {target_month: month + '-01'});
  if (initError) throw new Error('Widget budget could not load');
  const [cats, tx, budgets] = await Promise.all([
    fetchAllPages<BudgetCategory>((from,to) => client.from('budget_categories').select('id,name,monthly_limit,category_type').eq('user_id',userId).eq('is_active',true).order('id').range(from,to)),
    fetchAllPages<BudgetTransaction>((from,to) => client.from('transactions').select('id,category_id,transaction_date,amount,excluded_from_budget,is_transfer,plaid_removed_at').eq('user_id',userId).gte('transaction_date',start).lt('transaction_date',end).order('id').range(from,to)),
    client.from('budget_months').select('category_id,budget_amount').eq('user_id',userId).eq('month',month + '-01'),
  ]);
  if (budgets.error) throw new Error('Widget budget could not load');
  if (scope !== requestScope || requestVersion !== widgetRequest) return;
  const values = new Map((budgets.data ?? []).map(b => [b.category_id, b.budget_amount]));
  await BudgetNative.publish({scope: requestScope, snapshot: widgetSnapshot(cats.map(c => ({...c, monthly_limit: values.get(c.id) ?? c.monthly_limit})),tx,month,widgetSelection(userId))});
}
