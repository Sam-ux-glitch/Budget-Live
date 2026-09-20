# Budget Live — private iPhone testing handoff

Date: 2026-09-20. Branch: codex/savings-v2. Starting checkpoint: ab7c8d7393886595f1e52b4af8857f85ad4828f1 (Savings V2 and read-only Coach were working). Existing PR: https://github.com/Sam-ux-glitch/Budget-Live/pull/1, targeting main; do not merge without authorization.

## Delivery status

The existing app is extended, not rewritten. Web checks and iOS static export pass. The Capacitor App target and native WidgetKit extension are checked in. **An installable signed iPhone/TestFlight binary has NOT been built here**: this environment is Linux/Windows, without Xcode or Apple signing. Native compilation, provisioning, Plaid Universal Links, and real-device acceptance are required on the Mac. This is the principal deadline risk for September 21. Do not describe the milestone as a verified iPhone build until those checks pass.

Implementation commit: 5c9c0d9e19ef346d3b51b5e0a6646a12c95728e5. The following documentation commit completes this handoff; obtain its delivery hash with git log -1 --format=%H, or the final Work response. No merge to main.

## Completed features and usage

- Capacitor 8 shell packages the existing Next.js static export locally. Normal web builds retain their existing behavior. Dark UI, safe-area padding, mobile input sizing, keyboard resize, navigation and foreground refresh remain integrated with the current app.
- **Primary Home Screen widget:** medium and large native WidgetKit layouts, initially Dining & Coffee, Entertainment and Gas. Each row shows category, dollars remaining and a horizontal depleting bar. Tapping opens the app's Budget area for the current month.
- **Optional Lock Screen widget:** accessoryRectangular remains available as a second widget in the same extension. It shows compact monochrome rows and bars. It has not been removed.
- Budget: tap the displayed category dollar amount to edit the selected month. A separate Change Default control starts the new baseline next calendar month. Explicit monthly overrides and historical snapshots are preserved. There is no generic Edit Budget gate.
- AI Coach: ordinary answers remain grounded in selected-month facts. Supported requests produce a separate exact-change card with Approve changes and Reject. The model cannot approve. Successful approval reloads canonical app data; stale, expired, duplicate and failed approvals do not silently overwrite newer data.
- Supported proposals: monthly category amount, reallocation between two categories, future category default, monthly savings target/reset, individual transaction category, and merchant/Plaid-category rules. Manage rules conversationally; there is no Rules Settings page.
- Accounts: Connect Bank remains; Disconnect bank requires a separate confirmation, actually revokes the Plaid Item, and keeps historical imports. Failed revocation shows a retryable pending state. Connect Bank starts a fresh connection after disconnect.
- Sign-in: Forgot password requests a Supabase PKCE recovery email with a generic response. The recovery screen and Settings change-password form validate matching passwords of at least 12 characters.
- Settings: Change password, Widget settings, Privacy / Security, and App info are **all collapsed by default**. Compact full-width buttons have chevrons, visible keyboard focus, aria-expanded/aria-controls and labeled panels. Click, Enter and Space expand/collapse. Forms and category controls retain their behavior. App info displays web version or native version/build.

## Architecture and data flow

### Web and iOS

next.config.ts enables output: export only for CAPACITOR_BUILD=1. capacitor.config.ts uses webDir out, com.budgetlive.personal and no remote server URL. npm run ios:sync rebuilds and copies local assets. Do not point production Capacitor at a Codespace development URL. Supabase browser calls still use the public project URL/key and signed-in user's session; all RLS restrictions continue to apply.

The checked-in Xcode project uses Swift Package Manager for Capacitor App/Keyboard and Plaid LinkKit 7. BudgetViewController registers the narrow BudgetNative bridge. SceneDelegate preserves Capacitor URL delivery. budgetlive://budget opens the current-month Budget area; budgetlive://auth/recovery handles a PKCE code exchange. Native Plaid opens LinkKit rather than embedding Plaid's web flow inside WKWebView. Only a short-lived Link/public token crosses the bridge; access tokens remain server-side.

### Home Screen widgets

HomeBudgetWidget.swift provides systemMedium and systemLarge. Medium shows the header and three compact rows; large uses larger amounts, more spacing, monthly budget context and an update time. A small widget is deliberately not included because three categories would be cramped. Empty/stale snapshots prompt the user to open Budget Live. Negative remaining amounts are red with an empty bar. Whole-dollar display is for glanceability; calculations retain cents. Layout still needs simulator/device visual acceptance at actual text sizes.

Widget settings are saved per authenticated user and per device in local storage. Up to three existing categories can be selected; unchecking all hides values. Category names match existing categories, with no invented categories. Settings affect both Home and Lock widgets. Selection is not synced between devices, and separate per-widget-instance selections are not implemented.

### Calculation and refresh

app/lib/widget.ts reuses the canonical budget summary. Monthly remaining = effective current-month budget minus actual categorized spending, including refunds and excluding transfers, excluded and removed transactions. Progress = clamp(remaining / budget, 0, 1); zero budget gives zero progress. Example: 500 budget - 350 spending = 150 remaining, progress 0.30. Refund-driven remaining above budget keeps its true dollar value while the bar caps at 100%. Unassigned transactions are not attributed to a category.

app/lib/native.ts loads current-month owner-filtered categories, monthly budget rows and paginated transactions independently of whichever month the user is viewing. It publishes after successful app-data loads, edits, approvals, sync, widget selection changes and foreground refresh. Session/request generations reject late results from an older account or refresh.

BudgetNativePlugin validates the scope, month, timestamp, maximum three categories, numeric values, amount consistency and <8 KB payload. It re-encodes an allowlisted model into an atomic App Group JSON file, protected until first unlock and excluded from backup, then requests WidgetCenter reloads. WidgetKit only reads that file; it has no Supabase session, OpenAI key, account identifiers, transaction history or network access. Sign-out/account changes clear the file. iOS may briefly retain its last rendered image until it honors reload; privacySensitive is applied.

BudgetProvider requests a timeline refresh after 30 minutes; **iOS decides actual timing**. Refreshing the widget itself does not fetch bank data. Snapshots expire after 24 hours and at month rollover. Open/refresh/sync the app for current values. Background Plaid sync and push-driven widget refresh are deferred.

### Lock Screen support and shared configuration

BudgetWidget.swift keeps accessoryRectangular under kind BudgetRemaining. Home uses HomeBudgetRemaining. Both are in BudgetWidgets, with Home listed first, share WidgetSnapshot.swift and the same App Group, and use the same settings and deep link. Configure the App Group entitlement for BOTH App and BudgetWidget targets. Default group: group.com.budgetlive.personal; default extension ID: com.budgetlive.personal.widget. If changing identifiers, change APP_GROUP_ID for both build configurations/targets and provision the same group for both. Info.plist resolves BudgetAppGroup from this build setting.

### AI approval boundary and cost

ai-budget-chat reuses the existing Supabase OPENAI_API_KEY and existing Responses API model gpt-5.6-luna. No second provider/key or client key was introduced. Context is concise structured category/month totals, cash flow, Savings V2 effective target/default/override and warnings; only relevant transaction questions include a bounded 12-row detail sample. History/context limits, request validation and existing rate guards remain. store:false remains; structured output is limited to 1,800 output tokens, at most five proposed actions. No full lifetime transaction dump is sent. In-memory rate limiting is not a durable multi-instance quota.

The response JSON contains answer and typed proposed actions. The server may call create_coach_proposal to validate and store pending metadata, **never decide_coach_proposal**. The client renders exact scope/before-after values and submits a decision only from an explicit button. A chat message saying approve cannot perform the approval.

create_coach_proposal validates owned active categories, transaction ownership/month, currency bounds and supported shapes. The proposal captures a revision of canonical financial inputs and expires in ten minutes. decide_coach_proposal verifies auth ownership, status, expiry and revision under per-user advisory and row locks; all proposed actions apply in one database transaction. Relevant ordinary financial writes use the same user lock, preventing approval/edit races. Any error rolls back the entire decision. Reject changes only proposal status. An ambiguous network result tells the user to refresh rather than claiming success.

### Transaction rules

Approved rules use literal case-insensitive merchant/description or Plaid detailed-category substring matching, with nonnegative purchase amount and an optional inclusive maximum. Gas under $20 proposes TRANSPORTATION_GAS with maximum 19.99, not a utility-gas or broad merchant heuristic. Dunkin uses a merchant substring. Categories must exist for this user. Rules begin today and include matching unconfirmed purchases already imported with today's date or later; the exact scope is shown before approval. Confirmed, excluded, removed and transfer transactions are protected.

New approved rules outrank merchant memory; deterministic rules run before AI categorization. apply_ai_category only writes still-unassigned eligible transactions, so a late model result cannot overwrite a rule/manual assignment. Rules are per-user. Conversational creation and superseding matches are supported; comprehensive rule listing/editing/deletion is a future improvement.

### Plaid lifecycle

plaid-disconnect verifies the user, then service-role begin_plaid_disconnect locks the owned connection, changes it to disconnect_pending and reads its existing Vault token server-side. /item/remove revokes the Item with Plaid. finish_plaid_disconnect marks it disconnected only after success. Repeated requests and already-invalid/removed tokens are handled for retry. Pending status blocks new token retrieval and completion of an in-flight sync. Provider failures remain pending and must be retried; do not claim external revocation succeeded before it does.

Historical transactions remain; no real account was revoked during testing. A later Connect Bank uses normal fresh Plaid Link/exchange. This is reconnect by creating a new Item, not an emergency kill switch or a repair/update-mode implementation. A newly linked Item can import overlapping historical transactions; review this before repeated production relinking (automatic cross-Item historical deduplication is deferred). Keep PLAID_ENV consistent with existing Items; mixed sandbox/production Items are not supported.

### Authentication and privacy

Supabase PKCE stores the verifier on the requesting device; recovery must finish there. Recovery deep links contain a short-lived code, not an implicit access-token fragment. No password or real reset email was entered/sent during automated tests; tests use mocked accounts. Actual email delivery, allowlists and deep linking require device verification. App session persistence follows the existing Supabase client storage; a separate Keychain session-storage adapter is not implemented. The widget never receives that session.

RLS and auth.uid() ownership checks remain. Legacy single-settings-row/global merchant constraints were changed to per-user uniqueness. Cross-owner category assignments are rejected. Clients cannot directly insert proposals or change bank-connection lifecycle. Service-only RPCs return tokens only to server callers. OpenAI/Plaid/service-role secrets stay in Supabase. .env.local and generated bundles are ignored and must not be committed. Privacy UI contains no developer credentials/configuration.

## Database and deployment state

Applied successfully to project zqbazstlojsbdjfdsvff through the SQL editor on 2026-09-20:

1. supabase/migrations/202609200001_private_ios.sql
2. supabase/migrations/202609200002_plaid_disconnect.sql

These build on the existing migrations/schema, not a blank project. Settings and merchant_memory constraints, budget_months.is_override, baseline budget_history, category_rules.match_field/effective_from, coach_proposals, owner write guards, budget/rule/category/approval RPCs and service-only disconnect RPCs are included. Existing Savings V2 tables/RPCs are reused. No financial history was deleted. Read the SQL for precise signatures. Dashboard application does not update CLI migration history automatically: reconcile the migration ledger before using db push; do not blindly replay the migrations on production. No further financial SQL migration is required for this same project.

Live verification: coach_proposals RLS=true; authenticated INSERT=false; authenticated bank_connections UPDATE=false; authenticated begin_plaid_disconnect EXECUTE=false; service_role EXECUTE=true.

All six reviewed single-file bundles were deployed successfully through the existing dashboard. Source remains modular in the repository:

- ai-budget-chat — structured proposals and existing authenticated context.
- ai-categorize-transactions — exported existing implementation, rules-first and safe updates.
- plaid-create-link-token — native platform redirect configuration and existing browser flow.
- plaid-exchange-token — consistent PLAID_ENV and sanitized errors.
- plaid-sync-transactions — same configured Plaid environment; existing cursor/owner checks retained.
- plaid-disconnect — new actual revocation endpoint.

JWT verification remains enabled; each handler also checks the authenticated user. The new disconnect dashboard switch was verified ON. Unauthenticated POSTs to all six deployed URLs returned 401. No production financial action was used for testing. Live signed-in new Coach/actual Plaid/native flows still require acceptance testing; mocked/real-SQL fixture results must not be mistaken for that.

## Checks and exact results

- npm test: **42 passed, 0 failed**. Includes financial cents math, Savings V2, Coach context/provider errors, pagination/sync, disconnect orchestration, widget calculation and real PostgreSQL-compatible PGlite migration/RPC tests.
- PGlite private-iOS tests: **5 passed** within that total. Real SQL verifies month-only edits versus future defaults, historical preservation, no preapproval writes, rejection, expiry/replay/stale protections, atomic rollback, cross-owner proposal/category/rule restrictions, settings isolation, under-$20 boundary, service-only disconnect, blocked token read/in-flight apply, and a fresh connection.
- BUDGET_TEST_URL=http://localhost:3001 npm run test:browser: **21 scenario groups passed** (Budget 6, Savings 7, Coach 4, mobile/security/settings 4), no browser exceptions. All three grocery-overage/unexpected-expense/extra-savings starters exercised with controlled facts. No real financial changes.
- Settings tests specifically verify all four sections closed initially and click/Enter/Space toggling at 390px and 1280px, hidden controls while collapsed, no horizontal overflow, password validation/change and widget selection. Mobile screenshot visually reviewed.
- npm run lint: PASS after excluding generated ios/App/App/public assets (initial run incorrectly linted copied production bundles).
- npm run typecheck: PASS.
- npm run build: PASS (normal production web build).
- npm run ios:sync: PASS, static export and Capacitor sync; App and Keyboard SPM plugins recognized. Final UI changes repackaged.
- Deno 2.5.2 check: all six Edge Function entry points PASS with pinned Supabase 2.116.0 imports.
- Xcode project parsed successfully; App sources include bridge/controller/shared snapshot; BudgetWidget sources include Home and Lock plus shared snapshot; extension is embedded and a target dependency. This is structural validation, **not Swift compilation**.
- git diff --check: PASS. .env.local, out and copied iOS public assets confirmed ignored.
- npm audit --omit=dev: **0 vulnerabilities**. Full audit: **3 moderate development-tool findings** in @capacitor/cli/xcode/uuid dependency chain; no forced breaking dependency upgrade was applied.
- Six live unauthenticated function probes: **401 each**, as expected.

One browser-suite attempt used default port 3000 and failed connection-refused; rerun against the already running 3001 server passed. No duplicate dev server was started. Existing server remains on 3001. Test logs in /tmp are ephemeral; this report records the results.

## Manual Mac / iPhone steps (required)

1. Use a Mac with a compatible macOS, Xcode 26 or newer and its iOS simulator runtime; install Xcode command-line tools, launch Xcode and finish Apple's setup. Capacitor 8 requires Node 22+; this work used Node 24. An Apple Developer membership is needed for App Groups/TestFlight. Source: https://capacitorjs.com/docs/getting-started/environment-setup.
2. Clone/pull this repository, switch to codex/savings-v2 and pull its final commits. Do not recreate the iOS project or overwrite it with cap add ios. Run npm ci.
3. Create your local ignored .env.local using the existing NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY names used by app/page.tsx. Only public URL/publishable key belong in the client build. Never add service-role, OpenAI, Plaid client secret or access tokens. Existing Supabase secrets remain in place.
4. Run npm run ios:sync, then npm run ios:open. Open ios/App/App.xcodeproj if necessary. Let Swift Package Manager resolve Capacitor and Plaid LinkKit. Do not add CocoaPods or a second LinkKit dependency.
5. Select App target > Signing & Capabilities. Choose your Apple team and a registered unique bundle ID (default com.budgetlive.personal). Select BudgetWidget target, same team, extension bundle ID under the app prefix (default com.budgetlive.personal.widget). Match version 0.2.0 and build 1 in both targets; increment both for each upload.
6. Register an App Group in the Apple developer account; add it under App Groups to BOTH targets. Default is group.com.budgetlive.personal. If using a different identifier, change APP_GROUP_ID for Debug and Release on BOTH targets so both entitlement and Info.plist expansion match. Confirm the extension is in App's Embed App Extensions phase and target dependencies. Do not rerun configure-ios.cjs after personalizing IDs without reviewing it; it is a scaffold helper with original defaults.
7. Configure native Plaid OAuth BEFORE expecting Connect Bank to work. Choose a HTTPS domain you control and a redirect path such as /plaid/. Register that exact URI under Plaid Dashboard > Developers > API > Allowed redirect URIs. Add Associated Domains capability to the App target with applinks:YOUR_DOMAIN. Host /.well-known/apple-app-site-association as JSON over valid HTTPS without redirects, with your TEAM_ID.APP_BUNDLE_ID and the matching /plaid/* path. Set existing project's Supabase secret PLAID_IOS_REDIRECT_URI to that exact URI. Do not create a new OpenAI key. No domain/Apple team was provided, so these personalized settings are not fabricated in the repo. Follow https://plaid.com/docs/link/ios/. Preserve the configured PLAID_ENV used for your existing Items.
8. Supabase Auth > URL Configuration: allow budgetlive://auth/recovery and the exact web origin recovery redirect used by your deployment. Confirm email delivery configuration. Keep PKCE and auth protections. Request a reset on the same device/app where it will be completed; use your own account. The custom budgetlive URL scheme is already declared. For wider sharing, a claimed HTTPS recovery link is a recommended later hardening.
9. Select the App scheme and an iPhone simulator; Build/Run. Resolve any native compiler/SPM errors before claiming readiness; none could be checked here. Verify sign-in/out, Dashboard, Transactions, Budget, Savings, Accounts, Coach and Settings, keyboard resize/scrolling/safe areas and all error states. All four Settings sections should begin closed.
10. Sign in with your existing account. Tap category amount, save a month override; inspect next month and confirm default unchanged. Change Default and verify next-month baseline while an explicit override remains. Verify Savings override/reset and Coach proposals/rejection before approving a desired real change.
11. Add Budget Live to the simulator/iPhone **Home Screen**: long-press > Edit/Add Widget > Budget Live > medium or large. Select categories in app Settings. Confirm 500/350 shows 150 and roughly 30%, negative remaining has an empty bar, changes refresh after opening the app, and tapping opens current Budget. Also add optional Lock Screen rectangular widget and verify both share settings. Test logout/account change clears both; iOS timing can delay visual refresh.
12. Connect an iPhone by USB, trust the Mac, enable Developer Mode when prompted, choose the device and Run. Complete bank linking and OAuth return with your own bank/account. Only disconnect a real Item intentionally; confirm no further sync, then reconnect and inspect potential overlapping history. Test actual password recovery email and callback. Test another account's isolation using separate fixture/test accounts; never share a login.

## TestFlight private distribution

1. In App Store Connect create the app record for your registered bundle ID and platform. This administrative record is required even for private TestFlight; public marketing/release work is not part of this milestone.
2. In Xcode choose Any iOS Device (arm64), use Release signing and Product > Archive. Validate the archive, including the embedded widget, matching version/build, app icon, signing and privacy manifests. Review encryption/export compliance truthfully for the actual binary; no guessed declarations were added.
3. Organizer > Distribute App > App Store Connect > Upload. Wait for processing and address validation errors. Add an internal TestFlight tester and install through TestFlight on the iPhone.
4. A small number of friends can use external TestFlight invitations after Apple's required beta review; timing is outside this repo. Do not promise next-day external availability. Separate Supabase accounts remain mandatory.

## Remaining limitations / deferred items

- No signed binary, native compilation, simulator run, device keyboard/safe-area/WidgetKit visual test or TestFlight upload here. Signing, Apple membership, SPM downloads, personalized App Groups, native compiler issues and OAuth/domain setup can prevent tomorrow's first build. Prioritize local simulator/device build before polish.
- The existing web app remains the base; this is not SwiftUI app rewrite. Only widgets/bridge/Plaid presentation are native.
- Native Plaid deliberately reports setup unavailable until PLAID_IOS_REDIRECT_URI exists. OAuth Universal Link/AASA setup is required, not an optional visual polish task. Current bank Items may be sandbox; check existing environment before assuming real-bank readiness.
- Actual new deployed Coach response/approval and provider-backed revocation/reconnect acceptance remain unverified with a live signed-in account. Automated tests validate expected contracts and real SQL invariants; they cannot validate provider availability or Apple behavior.
- Device-local widget settings, no small widget, no per-widget independent category set, no automatic background bank sync, no instant refresh guarantee.
- Reconnect may import overlapping historical data from a new Plaid Item. A comprehensive relink-dedup/update-mode workflow is deferred.
- Conversational rule creation is implemented; rule inventory, removal, conflict explanation and richer previews are next improvements. A category must already exist; Coach does not create new categories.
- Password change uses existing Supabase session semantics; it is not an MFA/re-authentication redesign. Native auth tokens still use existing client persistence, not a new Keychain adapter.
- No new user onboarding/category seeding/public signup design was built. RLS supports multiple owners, but invited accounts need the existing provisioning process and their own data.
- Full audit has three moderate dev-tool dependency findings; production audit is clean. No force-upgrade was used near the deadline.
- Pending proposal retention/cleanup and durable per-user AI quotas are future operational improvements. USD remains the app currency.

## Continuation and rollback guidance

Read this report first, then AI_COACH_HANDOFF.md and HANDOFF.md for historical Savings/Coach context. Existing reports describe the older read-only Coach; this report supersedes that behavior. Repository and migrations are authoritative. Never overwrite working Savings V2 or re-create parallel AI infrastructure.

Starting checkpoint ab7c8d7 remains available. A code rollback alone does not undo deployed SQL/functions. Do not remove security guards or delete financial tables to roll back; inspect schema compatibility and use a reviewed forward fix. Existing old two-argument set_default_budget callers must be updated to the new effective-date contract. Both applied migrations retained financial records.

Next milestone: compile/sign and complete a real-device acceptance pass, then strengthen relink deduplication, claimed HTTPS recovery/Keychain persistence, rule management, durable quotas and widget refresh observability. Public App Store marketing and polish remain deferred.

## Changed-file inventory

The implementation commit's exact list is appended below. Generated out and iOS public assets are intentionally absent from Git and are recreated by ios:sync.

- app/components/AmountEditor.tsx
- app/components/BudgetCoach.tsx
- app/components/BudgetPage.tsx
- app/components/ConnectionList.tsx
- app/components/SettingsPage.tsx
- app/globals.css
- app/layout.tsx
- app/lib/chat-server.ts
- app/lib/chat.ts
- app/lib/coach-actions.ts
- app/lib/native.ts
- app/lib/widget.ts
- app/page.tsx
- capacitor.config.ts
- eslint.config.mjs
- ios/.gitignore
- ios/App/App.xcodeproj/project.pbxproj
- ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist
- ios/App/App/App.entitlements
- ios/App/App/AppDelegate.swift
- ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
- ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json
- ios/App/App/Assets.xcassets/Contents.json
- ios/App/App/Assets.xcassets/Splash.imageset/Contents.json
- ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png
- ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png
- ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png
- ios/App/App/Base.lproj/LaunchScreen.storyboard
- ios/App/App/Base.lproj/Main.storyboard
- ios/App/App/BudgetNativePlugin.swift
- ios/App/App/BudgetViewController.swift
- ios/App/App/Info.plist
- ios/App/App/SceneDelegate.swift
- ios/App/BudgetWidget/BudgetWidget.entitlements
- ios/App/BudgetWidget/BudgetWidget.swift
- ios/App/BudgetWidget/HomeBudgetWidget.swift
- ios/App/BudgetWidget/Info.plist
- ios/App/CapApp-SPM/.gitignore
- ios/App/CapApp-SPM/Package.swift
- ios/App/CapApp-SPM/README.md
- ios/App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift
- ios/App/Shared/WidgetSnapshot.swift
- ios/debug.xcconfig
- next.config.ts
- package-lock.json
- package.json
- scripts/configure-ios.cjs
- supabase/config.toml
- supabase/functions/ai-budget-chat/deno.lock
- supabase/functions/ai-categorize-transactions/index.ts
- supabase/functions/plaid-create-link-token/index.ts
- supabase/functions/plaid-disconnect/core.ts
- supabase/functions/plaid-disconnect/index.ts
- supabase/functions/plaid-exchange-token/index.ts
- supabase/functions/plaid-sync-transactions/index.ts
- supabase/migrations/202609200001_private_ios.sql
- supabase/migrations/202609200002_plaid_disconnect.sql
- tests/chat.browser.mjs
- tests/chat.test.mjs
- tests/disconnect.test.mjs
- tests/mobile.browser.mjs
- tests/private-ios.test.mjs

## Deployed bundle SHA-256 (dashboard copies verified before deploy)

- ai-budget-chat: 4f9bcf2f2cc70e20efabc22cc54c4051ecaf28fb4e7048fdbcd04f1710ae1d6d
- ai-categorize-transactions: 9848ed7631dd4fc4d3d4f23bf67fc23cce6f6bca1f4f0c0faf861b54d45e5d71
- plaid-create-link-token: a8518e4bd972cfbbb8df88e64eb56bbba7e0ba5de2969bc10cd6bea51e566f4a
- plaid-disconnect: 91fde05776df6047bb18edfad5972565e7aa7314d38cd503b9971ac03be54464
- plaid-exchange-token: c22b5d8564c9f4983090b90c10ccd50b9c9c3584a9e548b544a9eb1beaefe5d6
- plaid-sync-transactions: 0864a1bf0de93b99d39cea38186c3a777aa7620b6e3f37b47ce5b378d1a91bf6
