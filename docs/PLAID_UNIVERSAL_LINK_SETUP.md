# Native Plaid HTTPS Universal Link setup

Status: not configured. No hostname, Team ID or signing entitlement has been guessed or added.

## What was verified

- Installed app bundle ID confirmed by the user: com.budgetlive.personal.
- Repository bundle IDs: com.budgetlive.personal and com.budgetlive.personal.widget.
- Existing App Group: group.com.budgetlive.personal.
- The checked-in Xcode project has no DEVELOPMENT_TEAM or DevelopmentTeam. Matching history has none. The Mac's local signing configuration is not available in this Codespace.
- App.entitlements contains only the App Group; no Associated Domains capability is configured.
- No apple-app-site-association file or existing hosted redirect was found. GitHub has no homepage/deployments and no Pages site for this repository.
- Supabase PLAID_IOS_REDIRECT_URI is absent. The existing budgetlive://auth/recovery is for Supabase password recovery and must remain separate.

Plaid requires an HTTPS redirect for native iOS Link, registered with Plaid and configured as an Apple Universal Link. See [Plaid iOS documentation](https://plaid.com/docs/link/ios/) and [Plaid OAuth setup](https://plaid.com/docs/link/oauth/).

## Recommended small hosting setup

Use a dedicated **Cloudflare Pages static site** and its stable project.pages.dev HTTPS hostname. A custom domain purchase and hosting the full finance app are unnecessary for this purpose. The site needs only the public Apple association file and a minimal /plaid/ fallback page. It must contain no Supabase keys, Plaid credentials, account data, analytics or transaction information.

Cloudflare [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) avoids granting a hosting service access to the GitHub repository. Choose the actual project/hostname in the owner's account; availability has not been checked or reserved. Do not use a temporary Codespace or preview URL. Account setup/terms remain owner actions. No hosting account or deployment has been created in this session.

## Retrieve the exact signing identity on the Mac

In the Mac checkout used to install the app, run:

~~~sh
xcodebuild -project ios/App/App.xcodeproj -target App -showBuildSettings | grep -E 'DEVELOPMENT_TEAM =|PRODUCT_BUNDLE_IDENTIFIER ='
~~~

If DEVELOPMENT_TEAM is blank, open Xcode → App target → Signing & Capabilities and inspect the selected team; Apple Developer account Membership details also shows the Team ID. Share only the public Team ID and bundle ID, not credentials/profiles/certificates. Team IDs are generally alphanumeric, not necessarily numeric. Use the exact signed app's application-identifier prefix when building the association file; older accounts can have an App ID prefix different from their Team ID.

The user reports Samuel Smilowitz Personal Team. Confirm the selected provisioning profile supports Associated Domains and App Groups before proceeding. A free Personal Team is not equivalent to Apple Developer Program enrollment for TestFlight distribution. See Apple's [capability matrix](https://developer.apple.com/help/account/reference/supported-capabilities-ios/) and [membership comparison](https://developer.apple.com/support/compare-memberships/). Do not buy or change a membership automatically.

## Configure only after identity and host are confirmed

1. Create the static site with the confirmed stable HTTPS hostname. Prepare these files in a separate hosting directory, not in the native app's secret configuration:
   - /.well-known/apple-app-site-association (no .json suffix)
   - /plaid/index.html (plain fallback text such as Return to Budget Live; no token echo or query logging)
   - /_headers for the JSON response type.
2. Association JSON, replacing the placeholder with the exact signed application's identifier:

~~~json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "CONFIRMED_APP_ID_PREFIX.com.budgetlive.personal",
        "paths": ["/plaid/*"]
      }
    ]
  }
}
~~~

3. Cloudflare _headers:

~~~text
/.well-known/apple-app-site-association
  Content-Type: application/json
  Cache-Control: public, max-age=300
  X-Content-Type-Options: nosniff
/plaid/*
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
~~~

See [Cloudflare static response headers](https://developers.cloudflare.com/pages/configuration/headers/). Serve the AASA URL publicly over valid HTTPS with HTTP 200, without redirects, authentication, an interstitial or a challenge. Check Apple's [Universal Link troubleshooting](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links).

4. Use the exact redirect https://CONFIRMED_HOST/plaid/. Add it to Plaid Dashboard's allowed redirect URIs for the app. Set the existing Supabase project's PLAID_IOS_REDIRECT_URI to that identical URL. This setting is a URL, not a new API key. Leave PLAID_ENV=sandbox and keep all existing keys in Supabase secrets.
5. In Xcode add Associated Domains to the App target with applinks:CONFIRMED_HOST. Use the confirmed signing team and provisioning profile. Preserve the App Group on both targets, the widget bundle ID, and budgetlive://auth/recovery. Do not substitute the custom password-recovery scheme for Plaid's HTTPS URI.
6. Commit the verified entitlement/association hosting files once concrete. Rebuild with npm ci, npm run ios:sync, npm run ios:open, then build/install on the iPhone. Native compilation and signing must be checked on the Mac. The current repository already uses the existing LinkKit session integration; validate return from the chosen institution's OAuth flow on the physical device.
7. Confirm fresh /link/token/create success, complete sandbox linking/exchange/sync, disconnect and verify /item/remove + private/Vault cleanup, then reconnect and sync again. Verify old disconnected items cannot sync. Only this acceptance test can close the reported native reconnect issue.

## Deployment dependencies

The bank-security migration and all four matching Plaid functions were applied/deployed on 2026-09-21 after explicit approval. Preserve authenticated-user validation and review the existing legacy-JWT setting/config-file drift before future CLI deployment. See REAL_BANK_READINESS_HANDOFF.md for residual revocation and device-acceptance requirements.

There is no need to publish the app publicly or do App Store marketing. Once sandbox native acceptance and the bank-security blockers are resolved, follow IOS_TESTFLIGHT_HANDOFF.md for the existing private TestFlight workflow: pull branch, npm ci, sync/open iOS, verify signing/capabilities, run on device, archive, validate and upload in Xcode Organizer, then assign private testers in App Store Connect.

