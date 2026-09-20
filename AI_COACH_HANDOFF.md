> Current milestone: see [IOS_TESTFLIGHT_HANDOFF.md](IOS_TESTFLIGHT_HANDOFF.md) for iOS, Home/Lock widgets, approved AI actions, collapsed Settings, deployment and Mac steps. The content below records the earlier milestone.

# AI Budget Coach handoff — 2026-09-20

## Delivered state

The integrated, read-only AI Coach is implemented in the existing Budget-Live Codespace and deployed to the existing Supabase project. It reuses the existing OPENAI_API_KEY Supabase secret, Responses API, and gpt-5.6-luna model with reasoning disabled. No second key was created or requested, no key was copied to the Codespace/browser/Git, and no existing categorization function was modified.

- Working branch: codex/savings-v2.
- Clean starting/rollback commit: 71101c964237f2d23dabba1d4c67c98e88abffa8 (Savings V2).
- Completed implementation commit: 1798ce52bf20812ea477a233b37020b3fad6d553.
- This report is a subsequent documentation-only commit. The final delivery hash is shown in the task's final response and can be obtained with git log -1 --format=%H on this branch.
- Existing PR: https://github.com/Sam-ux-glitch/Budget-Live/pull/1, targeting main. No merge was performed.
- Deployed function: ai-budget-chat in project zqbazstlojsbdjfdsvff. JWT gateway verification remains enabled, plus explicit getUser validation inside the handler.
- Final deployed bundle SHA-256: 8ebd9e949b766e22ad51e62f10f3a1f30e4bafce9a8c56600e377b7e2e865b36. The dashboard editor was checked against the tested bundle before deployment.

## How to use

Open Budget Live, sign in, choose the budget month, and select AI Coach beside Savings. Choose a grocery-overage, dental-expense, or extra-savings starter, or type a question. Follow-up turns retain limited context. Expand App facts used to see server-derived figures and a timestamp separately from the model's suggestions. New chat clears the conversation; Cancel stops waiting. Failed questions remain available to retry.

The dashboard remains unchanged. Chat never changes a category, transaction, savings target, default, or bank connection. The user must separately edit Budget/Savings if they choose to act. Conversations are held only in component memory: changing month, refreshing budget data, leaving the section, page reload, or sign-out clears them. No chat-history table was added.

## Repository and deployed infrastructure inspected

Read AGENTS.md, CLAUDE.md, README.md, HANDOFF.md, SAVINGS_V2.md, current branch/history, PR #1 status, both migrations, the application loader/calculations, and the existing unit/browser suites. The starting tree was clean, with Savings V2 already committed and pushed; another checkpoint was unnecessary.

Savings V2 already includes automatic versus override targets, reset, expected paycheck/income assumptions, effective monthly budgets, projected surplus/shortfall, guarded accessible editing, and spending warnings. Its calculations and financial write paths were preserved. The only savings.ts change is an explicit .ts type-import extension for Deno compatibility.

The deployed ai-categorize-transactions source was inspected read-only in the Supabase dashboard. It authenticates the caller, uses OPENAI_API_KEY and the Responses API with gpt-5.6-luna/reasoning none, categorizes up to 25 pending transactions, and applies results through apply_ai_category. It is not checked into the existing repository. The coach reuses the provider configuration and Supabase function architecture, but does not call the mutating categorizer to answer chat. The four pre-existing Edge Functions were left unchanged.

Live catalog checks confirmed RLS enabled and owner policies on budget_categories, budget_months, transactions, settings, and monthly_savings_overrides. monthly_savings_summary and monthly_cashflow_summary are security_invoker views. expected_paychecks_for_month scopes settings to auth.uid() and reads the corresponding paycheck history. An equivalent owner DELETE policy for savings reset is already present in this live project. No schema or financial records were changed by these catalog queries.

## Files and functions

- app/components/BudgetCoach.tsx: integrated responsive chat, starters, follow-up history, session checks, cancellation, errors/retry, separate facts disclosure, privacy text, accessible labels/live updates.
- app/page.tsx: import, section type, navigation item, and month/user-keyed component mount only.
- app/lib/chat.ts: parseChatRequest, needsTransactionDetails, buildChatContext, budgetScenario, and COACH_INSTRUCTIONS.
- app/lib/chat-server.ts: createChatHandler, loadChatContext, bounded paginated reads/body parsing, authentication, usage guard, OpenAI request/response handling. Used server-side by the Edge Function; not imported as a runtime client module.
- supabase/functions/ai-budget-chat/index.ts: Deno entry point, existing secret/model wiring, CORS preflight, handler dispatch.
- supabase/functions/ai-budget-chat/deno.json and deno.lock: pinned Supabase module resolution for Edge compilation.
- supabase/config.toml: JWT verification enabled for this function.
- app/lib/savings.ts and tsconfig.json: explicit TypeScript import extension support shared by Node tests, Next.js and Deno.
- tests/chat.test.mjs: arithmetic, grounding, scope/auth, validation, privacy/minimization, failed-data/provider handling, limits and concurrency tests.
- tests/chat.browser.mjs: integrated UI using intercepted synthetic Supabase/OpenAI-function responses; package.json appends it to test:browser.
- AI_COACH_HANDOFF.md, HANDOFF.md and SAVINGS_V2.md: delivery documentation and current cross-references.

No SQL migration, database object, financial write RPC, Plaid implementation, categorization implementation, dependency package, package-lock, or .env.local change is required for the coach.

## Data flow and grounding

1. Client sends the selected month and at most seven alternating messages through the existing Supabase client to ai-budget-chat. The current access token is used; client-provided user IDs/financial context are rejected.
2. The server validates the token with Supabase getUser. It creates a caller-scoped client with the public/anon key, not a service-role client. Every table read has an explicit verified user filter, plus RLS.
3. Reads active categories, monthly overrides, selected-month transactions, expected income from monthly_savings_summary, savings_per_paycheck, monthly savings override, and expected_paychecks_for_month. No initialization or financial mutation RPC is called by the coach.
4. Reuses summarizeBudget and buildSavingsPlan. Refunds are netted; transfers, excluded and removed rows are omitted; pending purchases follow existing app behavior. Unassigned expenses remain explicit.
5. Computes a conservative spending reserve: sum of the greater of each category's plan or actual spending, plus positive unassigned spending. Cautious headroom is expected income minus that reserve minus the effective savings target. This does not subtract actual spending twice. It is a forecast, not a bank balance.
6. For dollar-denominated grocery/dental scenarios, the server supplies both conditional results: using an available existing allocation versus adding the entire amount on top of the monthly plan. Whether an expense is already recorded remains explicitly unknown. This prevents the model from assuming the full cost is an incremental budget increase.
7. The model receives compact fresh facts, not all transaction rows. Only transaction/merchant/recent-purchase questions receive up to 12 recent selected-month details, with merchant text capped at 100 characters. Account identifiers and category IDs are omitted from model facts.
8. The reply includes plain text plus separately calculated facts/timestamp. Missing income/target/balance/bills remain null or explicitly unknown. Financial figures in prior chat are not authoritative over the fresh snapshot.

## Security, privacy and cost controls

No write tools or proposed-action execution UI exists. Model output is rendered as text, not HTML. Names, descriptions, history, and questions are treated as untrusted data in the instructions. Raw provider/database error bodies, tokens, prompts and financial data are not logged by the coach. Replies use no-store. Chat uses store:false for Responses; this is not a claim of zero provider retention under every account policy.

Limits: 2,000 characters/message, seven sent messages, 24 KB request body, 24,000-character context cap, 100 categories/overrides and 20,000 monthly transactions (oversized/incomplete snapshots fail rather than truncate totals), 12 optional detail rows, 900 output tokens, one provider call/question, no automatic retry, 45-second upstream deadline and 55-second client deadline. In-memory guard permits one in-flight request, 10/minute and 60/day per verified user per warm instance. It is best-effort cost control, NOT a durable cross-instance quota; use provider project spending limits and a shared limiter before scaling. Cancellation may not reverse provider cost already incurred.

Model and secret configuration match the existing categorizer. No exact cost forecast is claimed; actual charges depend on token usage and the existing OpenAI account's pricing. API references: https://developers.openai.com/api/reference/cli/resources/responses/methods/create and https://platform.openai.com/docs/guides/your-data .

## Verification and results

- npm test: PASS, 35 tests, including existing budget, Savings V2 and Plaid core tests plus 16 coach tests.
- npm run lint: PASS.
- npm run typecheck: PASS.
- npm run build: PASS after final implementation.
- npm run test:browser: PASS, all 17 scenario groups across Budget, Savings and Coach. Includes old sync-then-AI behavior/failure recovery, full-month pagination, refunds/exclusions, monthly edits, reset, missing data, guarded writes, desktop/mobile, chat errors/retry/history, month cancellation, refresh and logout clearing. All automated browser financial requests use synthetic intercepted data.
- npx --yes deno@2.5.2 check --config supabase/functions/ai-budget-chat/deno.json supabase/functions/ai-budget-chat/index.ts: PASS.
- Single-file Edge bundle compiled successfully; checksum matched the dashboard source. Function deployed and redeployment completion verified. JWT verification stayed on.
- Live signed-in app: grocery-overage, dental-expense and extra-savings prompts returned answers grounded in the actual selected month and effective savings override. Compared source figures to dashboard/Savings data. Live testing found and corrected the dental-allocation assumption; its retest used only the uncovered expense amount and supplied concrete conditional reallocations. No model values or private financial screenshots were committed to the repository.
- Unauthenticated live POST: 401. App on localhost:3000: HTTP 200 after checks.
- Desktop/mobile synthetic visual captures reviewed; 390px overflow assertion passed. Temporary captures/logs are under /tmp in the Codespace.
- git diff --check: PASS.

These checks do not prove all future model answers will be arithmetically perfect. Model text remains a suggestion; the separately displayed app facts are deterministic.

## Deployment, setup and rollback

No user action is required to enable this delivery in the existing Codespace/project: ai-budget-chat is already deployed using the existing secret. No new migration or API key setup is pending. Refresh the app if the AI Coach navigation item is not yet visible. Frontend production hosting was not changed or merged; any separately hosted frontend must receive this branch through its established deployment process.

For future authenticated CLI deployment from repository root:

    npx supabase functions deploy ai-budget-chat --project-ref zqbazstlojsbdjfdsvff

Keep JWT verification enabled. Do not deploy all functions from this incomplete repository or overwrite the existing categorizer. The directory-specific deno.json resolves the shared caller-scoped Supabase import. CLI deployment itself was not used in this session; deployment used the authenticated dashboard and this tested single-file bundle:

    npx --yes esbuild@0.25.12 supabase/functions/ai-budget-chat/index.ts --bundle --format=esm --platform=neutral --alias:@supabase/supabase-js=https://esm.sh/@supabase/supabase-js@2.116.0 '--external:https://*' --outfile=/tmp/ai-budget-chat.ts

Paste that generated file into ONLY ai-budget-chat's index.ts in the dashboard, verify the source, then deploy. Regenerate whenever shared budget/savings/chat code changes. Do not add secret values to the generated bundle.

Rollback: revert the coach implementation commit on the working branch and redeploy the frontend as appropriate. The starting Savings V2 commit remains intact. To restore a prior coach version, regenerate/deploy its source from the corresponding Git revision; the dashboard does not provide automatic rollback. Avoid resetting away later user changes. Do not delete financial data.

The existing port-3000 dev server was preserved. No new application server was started. Pre-existing port 3100 and forwarding entries were not modified. Work terminal is idle after completion; all validation commands finished.

## Known limitations and next improvements

- No saved chat history, cross-month comparison, recurring bill schedule, actual received-income reconciliation, bank balance retrieval, or automatic reallocation. The UI explains these boundaries.
- Detailed transaction questions receive at most 12 recent rows, not merchant-search across a full history. Money follows the existing USD app convention; multi-currency accounting needs separate work.
- Multiple concurrent database reads are not a single transactional snapshot; another client may change data during a request. Refresh/re-ask when needed.
- Recommendations are prompt-guided free text. Conditional arithmetic is deterministic, but displayed prose can still be imperfect or overly verbose. A typed proposal/explanation schema with validated amounts would improve reliability.
- The usage guard is per warm instance and resets on redeployment/cold starts. Add a durable authenticated quota before multi-user rollout.
- Existing categorizer implementation is still production-only. Export/reconcile it in a separate task before changing its behavior; its current logging/error behavior was not changed here.
- Prior Savings migration remains a prerequisite for fresh environments; this existing project already has an equivalent owner delete policy. This repo is not a complete database bootstrap.

Recommended next work: typed reallocation proposals with arithmetic validation and freshness checks; optional explicit approval through existing edit RPCs; remaining-bill and received-income data; durable usage accounting; more real-world prompt evaluations. Preserve the read-only default.
