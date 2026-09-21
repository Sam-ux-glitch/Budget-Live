# Real-bank readiness handoff — 2026-09-21

## Release decision: NOT READY for a real bank

Do not change PLAID_ENV or connect a real institution yet. Code fixes and local checks are complete, but native reconnect has NOT been proven on the iPhone. After explicit user approval, the bank-security migration was applied and all four matching Plaid functions were deployed. Remaining items:

1. Configure the native Plaid HTTPS Universal Link, with the actual signing Team ID and a stable host. Neither is configured in this checkout. The installed app uses com.budgetlive.personal; the user confirms it is the native iOS app, not Safari.
2. Finish revoking the three recovered, paused legacy sandbox connections through Accounts → Retry disconnect. The original approval gate was resolved by the user’s explicit approval.
3. Verify the final private-token and Vault cleanup after those remote revocations; do not delete credentials before revoking them.
4. Complete a real-device SANDBOX connect → sync → disconnect → reconnect → sync acceptance test, including OAuth return to the app. Unit/SQL/browser fixtures are not a substitute for that test.
5. Review the remaining leaked-password warning and Apple signing/capability availability before release. No account upgrades or security-setting changes were made.

## Repository and preservation

Repository: https://github.com/Sam-ux-glitch/Budget-Live
Codespace checkout: /workspaces/Budget-Live
Branch: codex/savings-v2. Starting commit: 00e5ddb (clean, matched origin).
Completed implementation commit: **2a72b0e25205ff42e063a925cb141e85cb7519d5**.
This report is a subsequent documentation commit; obtain its exact revision with git log -1 --format=%H -- REAL_BANK_READINESS_HANDOFF.md. The final response records the final branch revision.
PR #1 remains OPEN, codex/savings-v2 → main: https://github.com/Sam-ux-glitch/Budget-Live/pull/1 . Nothing was merged.

Inspected current history, migrations, functions, prior Savings/Coach/iOS handoffs and the newer mobile commits. Preserved the four-category widget support, dashboard cleanup, mobile Coach/navigation, Savings V2, approved AI actions and collapsed Settings. No native Swift, signing, App Group, password-reset URL or OpenAI configuration was changed.

## Reconnect diagnosis

The deployed create-link-token function's authenticated iPhone invocation on September 21 at approximately 16:12 UTC returned HTTP 503 (function version 12, execution approximately 139 ms). OPTIONS succeeded. Logs showed startup/shutdown without a Plaid provider error. Its deployed source rejects platform ios when PLAID_IOS_REDIRECT_URI is absent; the live secrets inventory confirms that setting is absent. The user subsequently confirmed no native Plaid redirect/domain had been set up.

This is a native-link configuration failure before Plaid Link creation, not evidence that disconnect left the current connection active. The frontend hid the useful explanation behind the Supabase generic non-2xx error. The new server returns a stable NATIVE_LINK_NOT_CONFIGURED code, and the app displays an allowlisted explanation without displaying arbitrary backend text. This improves diagnosis; it does NOT fabricate a working redirect or claim native reconnect is fixed.

Repository verification: App.entitlements contains only the App Group. No associated-domain entitlement or apple-app-site-association file exists. SceneDelegate forwards URL/user-activity events to Capacitor. BudgetNativePlugin uses the existing retained LinkKit PlaidLinkSession. There is no DEVELOPMENT_TEAM/DevelopmentTeam in the checked-in Xcode settings or matching history. GitHub homepage is blank, Pages lookup returns 404, and deployments list is empty. A Mac-local signing selection cannot be recovered from this remote checkout.

See docs/PLAID_UNIVERSAL_LINK_SETUP.md for the recommended minimal hosting approach and exact next steps. budgetlive://auth/recovery is the separate existing password-recovery URL and was preserved.

## Implemented code changes

- app/lib/bank-errors.ts and app/page.tsx: safe reconnect errors keyed by server codes; signed-in-owner recheck after the asynchronous error read.
- supabase/functions/_shared/plaid.ts: shared strict sandbox/production selection; sandbox requires PLAID_SANDBOX_SECRET and never falls back to a potentially production secret; production uses PLAID_PRODUCTION_SECRET or the existing PLAID_SECRET. Fixed provider hosts, HTTPS native redirect validation, safe errors and no-store responses.
- plaid-create-link-token/core.ts and index.ts: validate method, bearer authentication through Supabase Auth, request/platform, credentials and native redirect before provider calls. Use the verified user's ID. Return only Link token/expiration, never an access token or arbitrary upstream payload. Bound provider/auth request timeouts.
- plaid-exchange-token/index.ts: verify the user, method and environment-matching public token; exchange server-side; call one atomic register_plaid_connection RPC. Only return success. On database failure attempt remote /item/remove; log only a constant cleanup-failure event if that fails. A simultaneous database failure and remote cleanup failure still needs operator investigation; no distributed transaction can guarantee both services commit together.
- plaid-sync-transactions/index.ts: preserve verified-owner/active-connection filtering, private token reads, cursor checks, ownership checks and atomic sync application. Refuse environment mismatches before reading/sending a token to Plaid.
- plaid-disconnect/index.ts: reuse strict environment selection, validate UUID shape, require matching stored environment before /item/remove. Retain pause → revoke → finish sequencing and safe retry errors.
- package.json/package-lock.json: narrowly override xcode's uuid to patched CommonJS-compatible 11.1.1; no audit fix --force and no Capacitor downgrade. Pin Deno 2.5.2 and add npm run check:edge.
- .vscode/settings.json/extensions.json, supabase/functions/deno.json and deno.lock: scope Deno to Edge Functions, retain ordinary TypeScript for Next.js, configure the installed Deno runtime and lock dependencies. The normal web tsconfig exclusions were preserved.
- .gitignore: preserve .env* protection and add private key/signing/service-account filename patterns.
- .gitleaksignore: only two exact reviewed historical false-positive fingerprints, both bundle SHA-256 values in the old iOS handoff. No whole-file/rule suppression.
- tests/bank-security.test.mjs: four new Link/configuration/redaction contracts. Browser tests updated for the already-existing dashboard month label and Coach composer, plus a reconnect configuration-error UI assertion. No working UI was reverted to satisfy old selectors.

## Database changes — applied 2026-09-21

supabase/migrations/202609210001_bank_security.sql targets this existing database, not a blank installation.

- Adds bank_connections.plaid_environment, checked to sandbox/production, default sandbox for this confirmed sandbox project.
- Captures the reviewed live create_month_income, store_plaid_token_in_vault, read_plaid_sync_token, apply_plaid_sync and finish_plaid_disconnect definitions so newer live protections are not lost. The existing monthly_income unique(user_id,month) constraint remains intact.
- Keeps private-token table access denied to public/anon/authenticated and token/sync/disconnect RPCs service-role-only.
- Revokes public-schema CREATE and unnecessary client TRUNCATE/TRIGGER/REFERENCES; revokes public/anonymous app-function execution while explicitly preserving previously effective authenticated/service-role execution where appropriate.
- Places pg_catalog first and pg_temp last for app functions; qualified Vault/token functions use an empty search path. Existing authenticated Coach/rule definer functions retain their internal auth/ownership checks.
- begin_plaid_disconnect locks the owned connection and commits disconnect_pending before the HTTP revoke step, including the missing-token case. It returns environment only to the service-role caller. Already-disconnected cleanup is idempotent.
- finish_plaid_disconnect preserves the user's live fix: mark disconnected, delete the owned private-token row, delete the corresponding Vault secret.
- Adds service-only register_plaid_connection(uuid,text,text,text), with a per-item advisory lock, owner/environment collision checks and one transaction for encrypted Vault storage + private metadata + active connection registration.

The approved migration was applied through the Supabase SQL editor. Financial transactions, budgets and savings values were not changed. Validation/lifecycle fixtures were rolled back. A separately reviewed recovery script restored three missing sandbox connection metadata rows as disconnect_pending; it did not activate sync or delete credentials. The final live audit confirmed plaid_environment exists. SQL-editor application does not automatically register a CLI migration-history version; reconcile that history before any future migration push.

## Live security findings and isolation test

Supabase project: zqbazstlojsbdjfdsvff. The dashboard labels its database branch production; that is NOT the Plaid environment. PLAID_ENV is confirmed sandbox by comparing its dashboard digest with SHA-256(sandbox), without revealing a secret value. PLAID_CLIENT_ID, PLAID_SECRET, PLAID_SANDBOX_SECRET and OPENAI_API_KEY are backend secrets. No keys were copied into source or replaced. Production Plaid access/credentials were not exercised or certified.

All 19 public base tables have RLS enabled. All seven reviewed financial views use security_invoker. Owner policies scope financial rows to auth.uid(), including write checks. No anon financial table grants were found; authenticated grants are scoped by existing table/function purpose. There are zero client TRUNCATE/TRIGGER/REFERENCES grants. Public-schema CREATE is denied. Private token rows are inaccessible to client roles. All six privileged token/sync/disconnect/registration functions are service-role-only. Intentional authenticated SECURITY DEFINER functions (apply_transaction_rules, create_coach_proposal, decide_coach_proposal) verify identity/ownership; proposals retain explicit approval, stale revision, expiry, replay and atomic-write protections.

Executed supabase/tests/cross-user-isolation.sql against the live database in a rollback transaction: a different simulated authenticated identity could not select, update or delete the existing owner's rows across 18 owner-bearing base tables and seven views; denied table privileges were accepted as secure denial. After applying the migration, 49 checks passed: 25 cross-owner reads, 18 combined update/delete checks, and six privileged RPC client-execution denials. Tests are non-vacuous for populated financial tables; empty tables are covered by policy/privilege review and local fixtures, not claimed as populated two-user live tests. The identity was set through PostgreSQL role/JWT claims, not a newly created real login. sync_log has no client grant/policy. Existing automated database fixtures separately test owner/proposal/rule isolation and cross-owner category rejection.

Security Advisor: **0 errors, 4 warnings, 2 informational items**. Three warnings identify the deliberately authenticated definer functions above; do not blindly revoke them and break the app. The remaining warning is disabled leaked-password protection, shown as a Pro-plan feature in the current Free project. Informational no-policy notices for plaid_private_tokens and sync_log are intentional deny-by-default. Secure email change and email confirmation are enabled; anonymous sign-in is disabled. Other password/auth settings were not changed.

Final residual audit: one disconnected connection and three disconnect_pending connections; zero orphan private-token rows, zero private tokens on disconnected rows, three private tokens on the paused connections, and zero Plaid Vault entries without private metadata. Server-side preflight confirmed sandbox token format without exposing token values. The paused connections cannot sync. Their remote revocation is still pending.

Applied supabase/maintenance/recover-orphaned-sandbox-connections.sql after a rollback-only rehearsal: three missing metadata rows were restored exclusively as disconnect_pending. Sign in as the affected owner, refresh Accounts, use Retry disconnect for the three paused connections, and verify /item/remove plus private/Vault cleanup. This action does not require the missing native Link redirect. Preserve tokens until revocation is confirmed.

## Checks and exact outcomes

| Check | Result |
| --- | --- |
| npm run typecheck | PASS |
| npm run lint | PASS |
| npm run build | PASS, current production web output |
| npm test | 46 tests passed, 0 failed |
| npm run check:edge | PASS, all six Edge Function entry points |
| BUDGET_TEST_URL=http://localhost:3001 npm run test:browser | PASS, all four suites / 21 reported scenario groups |
| Updated mobile suite with reconnect error assertion | PASS; safe diagnosis visible, upstream detail absent |
| npm run ios:sync | PASS, static export and Capacitor iOS sync |
| Xcode JS parser, UUID generation and project serialization | PASS with uuid 11.1.1 |
| npm audit | 0 vulnerabilities: 0 low/moderate/high/critical |
| Codespaces Problems | UI reports no problems detected |
| Live deployed HTTP probes | 16 PASS: missing/invalid authentication rejected, unauthenticated GET rejected, OPTIONS/CORS succeeds on all four functions. Link GET returns 405; the other gateways return 401 before handler method validation. No provider token appears in responses. |
| Live cross-user SQL | 49 checks PASS after migration, within rollback; scope described above |
| Migration + token lifecycle SQL | PASS before and after live migration, within rollback: atomic registration, cross-owner rejection, paused token reads, private/Vault cleanup, separate reconnect registration |
| Gitleaks all fetched refs/history | 18 commits through implementation commit, no unsuppressed leaks; only two reviewed hash false positives |
| Gitleaks staged changes and final exported iOS web assets | No leaks found |
| Git ignored secret/signing paths and historical filenames | .env.local/.env.production/key/p12 ignored; no matching secret/signing files found in reachable history |
| git diff --cached --check | PASS after normalizing copied SQL line endings |

The initial browser attempt used 127.0.0.1, which Next's dev-origin protection rejected. Retested on localhost without weakening allowedDevOrigins. Two test selectors were stale after prior dashboard/Coach changes and were corrected. Runtime Node experimental/type-module warnings are test-runner notices, not TypeScript errors. The previous roughly 13 editor diagnostics were resolved by Deno scoping/runtime configuration; independent Deno and web type checks pass. Browser tests intercept Supabase/provider traffic with synthetic fixtures; they do not prove live Plaid or real OpenAI responses. No Xcode native compilation, physical-device OAuth, password email delivery or TestFlight upload was run here.

## Deployment and continuation order

Completed: approved migration and paused metadata recovery applied; plaid-create-link-token, plaid-exchange-token, plaid-sync-transactions and plaid-disconnect deployed from the committed repository sources (bundled with external Supabase import), with editor contents compared before deployment. AI functions and all existing secrets were left unchanged. Post-migration isolation/lifecycle checks passed.

1. Complete the Universal Link setup document and rebuild on the Mac, preserving password recovery and App Group/widget configuration.
2. Sign in and revoke the three paused sandbox connections via Accounts → Retry disconnect; rerun bank-security-audit.sql until no pending/orphan/disconnected token residue remains.
3. Complete real-device sandbox connect → sync → disconnect → reconnect → sync, including institution OAuth return. Verify old items cannot sync and provider revocation succeeds.
4. Preserve verified-user authentication. The inspected live Link function has its legacy JWT toggle off and validates users through Auth internally; other functions may reject requests at the gateway. Repository config.toml still contains verify_jwt=true. Dashboard deployments preserved existing toggles. Reconcile this drift before using CLI deployment; do not bypass getUser or trust client-supplied user IDs. Valid signed-in and expired-session device acceptance remains required.
5. Review the leaked-password protection warning and confirm Apple provisioning/Associated Domains/TestFlight eligibility. Only after every blocker is resolved should the owner separately authorize a production switch and one-bank acceptance test.

## Known limitations / next milestone

HTTPS host, Team ID/provisioning and native reconnect proof remain missing. Migration, deployment and paused metadata recovery are complete. Remote revocation of the three paused connections remains pending. If both exchange persistence and compensating remote removal fail, an operator must investigate the safe cleanup-failure event; do not treat it as success. A future milestone should add durable reconciliation/alerts, explicit bank consent/retention controls and a repeatable staging integration suite. Keep the current personal/private multi-user design and existing RLS; do not rebuild the app.

The prior IOS_TESTFLIGHT_HANDOFF.md remains the reference for the Capacitor/WidgetKit architecture and detailed Mac signing/TestFlight steps. This report supersedes its bank-readiness status. Current Home Screen widgets support the newer four-category selection; optional Lock Screen support is preserved. This session changed no widget calculations or UI.

## Workspace closeout

The temporary test server on port 3001 was stopped after verification; unrelated servers were preserved. The final documentation/audit commit follows implementation 2a72b0e. Both commits are intended for the existing codex/savings-v2 branch and open PR #1, with no merge to main. The report also adds a bank-readiness pointer to IOS_TESTFLIGHT_HANDOFF.md and a pending-token count to the reusable bank-security audit.
