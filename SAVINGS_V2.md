# Savings V2

## Behavior and sources

Savings remains a top-level section. The four planning cards show expected income, selected-month planned spending, projected surplus before savings, and the editable monthly savings target. A separate automatic target shows saved savings-per-paycheck multiplied by the expected paycheck count, even when a monthly override is active.

- Income: existing monthly_savings_summary.expected_income. Missing income remains unavailable, not zero.
- Planned spending: the same effective monthly category budgets used by Budget, including budget_months overrides. A failed budget_months request rejects the snapshot instead of silently using defaults.
- Projected surplus: income minus planned spending. Support headroom: surplus minus effective savings target. Shortfall is max(0, -headroom), including months with negative surplus.
- Automatic target: settings.savings_per_paycheck × expected_paychecks_for_month count. Removed the previous hard-coded fallback. Missing defaults are shown as unconfigured; a real zero setting or zero override is valid.
- Monthly override: existing monthly_savings_overrides record keyed by user_id and month. Click amount, type, and Enter or blur to save. Escape or Cancel discards edits. Blank, negative, unsafe and fractional-cent values are rejected.
- Reset: delete the selected owner's selected-month override. The default is recalculated on every load, rather than copied into another fixed override. A zero-row delete is not reported as success.
- Saving disables navigation/refresh/sign-out; duplicate Enter/blur writes are blocked. A late mutation response cannot reload an obsolete request scope. Savings data clears on auth changes.
- Actual over-budget categories and unassigned transactions are shown separately as review warnings. Actual spending is not subtracted a second time from a budget-based forecast.

The Dashboard uses the same savings plan facts. Budget's existing presentation was moved to app/components/BudgetPage.tsx to keep React event handling outside nested render helpers; its edits and calculations retain their existing behavior. Transactions, Accounts, Plaid functions, auth and default-budget RPCs are preserved.

## Supabase migration

Apply supabase/migrations/202609190002_savings_reset.sql to the existing Savings V1 database before relying on reset. It grants authenticated DELETE and adds an owner-only DELETE policy using auth.uid() = user_id. It requires the existing table with RLS enabled and leaves existing SELECT/INSERT/UPDATE policies, defaults, financial rows, and schema columns unchanged. If an equivalent owner DELETE policy already exists, reset may already work; the migration makes that capability explicit and repeatable.

The migration was supplied, not applied to the live database. No real banking or savings records were changed by testing. The repository does not contain all deployed Savings V1 schema definitions; do not treat its migration directory as a complete fresh-database bootstrap. No new table or data backfill is required.

## Verification

- Checkpoint before modifications: f797279, based on clean abbe5c4.
- Baseline production build passed.
- Stage 1: 19 unit tests (including 6 Savings cases), production build passed.
- Stage 2: lint and production build passed after UI integration.
- Final checks: all 19 unit tests, lint, TypeScript compilation in the production build, and the production build passed. Both browser suites passed (13 scenario groups), including keyboard Cancel after Tab. Desktop visual capture reviewed; mobile overflow check passed at 390px.
- npm run test:browser runs existing Budget scenarios and the Savings suite. Start a dev/production server first; BUDGET_TEST_URL selects it.
- Browser tests intercept all Supabase traffic and use synthetic data. They cover defaults, monthly budgets, override vs automatic target, shortfall, refresh, separate months, zero, validation, keyboard/click-away editing, failed/denied writes, reset and later default changes, pending-write controls, missing data, month-budget failure, mobile overflow, logout and existing pages. Budget regression covers pagination, refunds, exclusions, month changes, sync followed by AI and failure recovery.
- Live authenticated persistence and deployed RLS must still be smoke-tested after applying the migration. Synthetic tests do not prove production policies.

## Next: a read-only AI Budget Coach

app/lib/savings.ts exports buildSavingsPlan and SavingsPlan: a serializable, versioned monthly snapshot containing income, planned spending, both targets, target source, paycheck assumptions, surplus, shortfall, category planned/spent/remaining/overspent values, and unassigned transaction totals. The UI consumes the same facts that can ground future recommendations.

First add a read-only recommendation layer: identify over-budget categories and unexpected/unassigned spending, propose explicit category-to-category reallocations or a monthly savings adjustment, and explain the effect on savings shortfall. Unspent allocations are not automatically safe to move; retain room for remaining bills, recurring obligations and the rest of the month. Require a complete snapshot and label income assumptions. Keep recommendations separate from approved actions.

Before enabling writes, validate category IDs, owner/month scope, cent totals and freshness on the server. Present before/after amounts for user approval; then call existing monthly-budget or savings-override operations. Log proposal approval and re-fetch the snapshot. Do not change permanent defaults or expose Plaid credentials to a model. No AI provider, automatic reallocation, or new AI network call is added by Savings V2.
