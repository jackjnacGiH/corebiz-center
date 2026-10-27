# OmniChat / Shipping startup release

Base: `e2b0b1c84acbdd21b3448285b74b3cdd6463fb98`, also identified by Vercel as the preceding production deployment. Scope is browser route startup only. No Edge Function, schema, permission, webhook, LINE OA or customer-data change.

## Diagnosis and change

ProtectedRoute previously delayed rendering lazy Chat/Shipping until session and active profile were resolved. The requested page's JavaScript therefore started later than necessary. A small route-code warmup now shares each lazy import and starts ONLY the requested Chat or Shipping download while auth resolves. Downloading code neither mounts the page nor starts its page effects. Public and other routes do not preload either module. Rejected speculative imports are handled and may be retried on a later demand; there is no automatic retry loop. Interrupted navigation cannot publish stale data because warmup publishes no state/data.

OmniChat also previously started speculative Shipping initial data 150ms after Layout mounted. Layout now omits that prewarm on `/chat` and `/chat/`; explicit Shipping navigation and other routes retain existing scoped cache/deduplication. This removes one off-route Edge request from Chat startup. Auth, route roles, list freshness, company enrichment and room-selection behavior are unchanged.

This is a verified dependency/competition reduction, not a verified explanation of the reported 1–5 minute startup. Session watchdog 8s and profile attempt deadlines 6s/8s are configuration values, not measured latency. Shipping still waits for verified server permissions, then bootstrap plus list; exact count, full data and editor behavior are retained.

## Validation

- 611 repository tests pass, including existing auth/profile races and failures, account isolation, Shipping revoked access, superseded requests, interrupted navigation and Chat context tests.
- New deterministic tests show route download starts while an auth promise is unresolved, imports are shared, failed speculation is handled/retryable, and unrelated/public routes do not download either priority route.
- Layout tests verify no Shipping prewarm on Chat, bounded warmup elsewhere and cancellation during import.
- CoreBiz lint: 0 errors; three existing warnings outside this patch. Storefront lint passes.
- CoreBiz TypeScript + Vite production build passes. Build chunk warnings remain; these are not new latency measurements.
- Existing Linux CI remains the release gate, including the full suite, lint, type checks and both service builds. The workflow deploys Vercel only; no migration or Edge deploy steps exist.

## Measurements and verification limits

Pre-release existing-session observation in an agent-created Chrome tab: OmniChat overview rendered with no textarea/conversation selected, then Shipping list and pagination rendered. Source production entry asset was `/center/assets/index-B0xsz7lC.js`. No customer room was opened or messages sent/read. Owner tabs were untouched.

Browser Performance API/DevTools timing restrictions from the preceding investigation were not retried or bypassed. No valid before/after waterfall, first useful-data duration, p50/p95, JS evaluation duration or post-reboot result is claimed. Test runtime and build duration are not user-visible loading time. Slow/failed requests and role restrictions are covered in isolated tests, not by deliberately breaking live production or impersonating another role.

## Rollback and follow-up

Rollback by reverting this performance commit through the same tested release workflow. No data rollback is necessary. To investigate any continuing minutes-long wait, capture the first actual post-reboot navigation with the owner at a safe time, retaining cache/session; compare same-route reload and SPA revisit separately. Record auth/profile, requested chunk, base list response, enrichment and rendering separately. Test each priority route as the first route on separate starts. Do not export raw credentials/customer-bearing HARs.
