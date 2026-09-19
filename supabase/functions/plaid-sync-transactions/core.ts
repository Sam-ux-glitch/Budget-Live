export type PlaidTransaction = {
  transaction_id: string; account_id: string; date: string; amount: number;
  pending: boolean; pending_transaction_id?: string | null;
  merchant_name?: string | null; name: string; merchant_entity_id?: string | null;
  iso_currency_code?: string | null;
  personal_finance_category?: { primary: string; detailed: string } | null;
};
export type PlaidAccount = { account_id: string; name: string; type: string; mask?: string | null };
export type SyncPage = { added: PlaidTransaction[]; modified: PlaidTransaction[];
  removed: { transaction_id: string }[]; accounts: PlaidAccount[];
  next_cursor: string; has_more: boolean; transactions_update_status?: string };
export class SyncError extends Error {
  constructor(public code: string) { super(code); }
}
export function normalizeTransaction(t: PlaidTransaction) {
  if (!t.transaction_id || !t.account_id || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) ||
      !Number.isFinite(t.amount) || typeof t.pending !== 'boolean') throw new SyncError('INVALID_PLAID_DATA');
  const primary = t.personal_finance_category?.primary ?? null;
  const detailed = t.personal_finance_category?.detailed ?? null;
  const transfer = ['LOAN_PAYMENTS_CREDIT_CARD_PAYMENT','TRANSFER_IN_ACCOUNT_TRANSFER',
    'TRANSFER_OUT_ACCOUNT_TRANSFER'].includes(detailed ?? '');
  const uncertainTransfer = !transfer && (primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT');
  const unsupportedCurrency = t.iso_currency_code !== 'USD';
  return {
    transaction_id:t.transaction_id,account_id:t.account_id,date:t.date,amount:t.amount,
    pending:t.pending,pending_transaction_id:t.pending_transaction_id ?? null,
    merchant_name:t.merchant_name ?? null,name:t.name,merchant_entity_id:t.merchant_entity_id ?? null,
    iso_currency_code:t.iso_currency_code ?? null,category_primary:primary,category_detailed:detailed,
    is_transfer:transfer,excluded_from_budget:transfer || primary === 'INCOME' || unsupportedCurrency,
    needs_review:uncertainTransfer || unsupportedCurrency,
    review_reason:unsupportedCurrency ? 'Currency needs review before USD budget inclusion' :
      uncertainTransfer ? 'Confirm whether this transfer is between your own accounts' : null,
  };
}
// Preserve the original cursor and discard partial pages if Plaid changes the update mid-pagination.
export async function collectSync(
  originalCursor: string | null,
  request: (cursor: string | null) => Promise<SyncPage>,
) {
  for (let attempt=0; attempt<3; attempt++) {
    let cursor=originalCursor;
    const transactions = new Map<string,ReturnType<typeof normalizeTransaction>>();
    const removed = new Set<string>();
    const accounts = new Map<string,PlaidAccount>();
    try {
      for (let pageNumber=0; pageNumber<100; pageNumber++) {
        const page=await request(cursor);
        if (!page.next_cursor || typeof page.has_more !== 'boolean' ||
          !Array.isArray(page.added) || !Array.isArray(page.modified) ||
          !Array.isArray(page.removed) || !Array.isArray(page.accounts)) throw new SyncError('INVALID_PLAID_DATA');
        for (const a of page.accounts) accounts.set(a.account_id,a);
        for (const t of [...page.added,...page.modified]) {
          transactions.set(t.transaction_id,normalizeTransaction(t)); removed.delete(t.transaction_id);
        }
        for (const t of page.removed) { removed.add(t.transaction_id); transactions.delete(t.transaction_id); }
        if (transactions.size>50000) throw new SyncError('SYNC_TOO_LARGE');
        if (!page.has_more) return {accounts:[...accounts.values()],transactions:[...transactions.values()],
          removed:[...removed],cursor:page.next_cursor,status:page.transactions_update_status ?? 'UNKNOWN'};
        if (page.next_cursor === cursor) throw new SyncError('INVALID_PLAID_CURSOR');
        cursor=page.next_cursor;
      }
      throw new SyncError('SYNC_TOO_LARGE');
    } catch (error) {
      if (!(error instanceof SyncError) || error.code !== 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' || attempt===2) throw error;
    }
  }
  throw new SyncError('SYNC_RETRY_REQUIRED');
}
