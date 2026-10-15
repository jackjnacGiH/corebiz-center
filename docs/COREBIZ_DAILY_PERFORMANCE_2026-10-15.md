# CoreBiz daily workflow performance — 2026-10-15

Scope approved by Boss jack: duplicate reads, Dashboard, large lists, with Shipping/PromptSpeed and Omni-Chat as daily priorities. Product image optimization is additive. All business formulas, permissions and user workflows remain unchanged.

## Data/API change set

- Dashboard KPI reads run concurrently (orders, inventory, customer count). Activity reads also run concurrently. Same columns, filters, counts, revenue exclusions and error checks.
- Remove the automatic complete catalogue/CRM prefetch while using unrelated pages. Hover/focus on the relevant menu warms only its required lists. Shipping's existing bounded first-page prefetch remains.
- CRM uses the common identity-cleared SWR cache instead of a separate module cache. Initial reads share prefetch work; explicit reloads, writes and realtime still force new data. A fast background refresh cannot be overwritten by stale data while branches load.
- Chat shares identical message-page reads only while in flight, including prefetch-to-room handoff. Different rooms, sizes and cursors stay separate. Each subscriber can cancel independently; abandoned network work is cancelled after a 100ms handoff and every read is bounded by 10s. Auth identity reset aborts and detaches pending reads. Settled responses are never reused by this helper.
- PromptSpeed carrier metadata is shared for at most 30s in a bounded, credential/environment/readiness-scoped isolate cache. Errors are not cached. Every comparison still gets fresh monetary quotes, retaining identical-box reuse, exact totals, PDF references and provider error handling.
- Eligible Flash status refresh starts the existing PromptSpeed list read and service-only Postgres Flash RPC together. Exact tracking/carrier matching, timestamps, terminal-state precedence, charge handling, version checks and authentication remain.
- Bulk status checks keep three concurrent requests, immediately filling free slots. Remaining list pages are also bounded to three concurrent reads. Terminal/no-tracking exclusions and partial failure reporting are unchanged.

## Rendering/image change set

- Reuse unchanged Chat inbox and Inventory table subtrees instead of rebuilding them during unrelated state changes. Inventory search uses deferred rendering; full filters, sort, selection, CSV export and expanded details retain every row.
- Product cards use browser content visibility outside the viewport, retaining their DOM and accessibility. Printing explicitly renders all cards.
- Public product/group images have separate 960px WebP list variants at quality 88. Full/hover previews keep original URLs; variant load failure falls back to the original. No original objects or database image URLs were changed. Private/chat images and organization logos are excluded.
- New JPEG/PNG product uploads only: maximum 1920px, WebP quality 90, no upscaling; use the original if conversion fails or saves less than 10%. Small images, GIF, WebP and APNG retain their original files. Existing 5MB/type validation remains.

## Reproducible measurements

Fixed 60ms read fixture, same API methods before/after (`scripts/measure-daily-performance.mjs`):

| Path | Before | After | Requests |
|---|---:|---:|---|
| Dashboard KPI | 217ms | 65ms | Same three reads, concurrent |
| Recent activity | 136ms | 61ms | Same two reads, concurrent |
| Two simultaneous identical Chat pages | 70ms | 71ms | 2 → 1 |

Actual Chat TSX in the isolated component harness, 500 rooms and 100 composer updates (`scripts/measure-chat-render.mjs b1b53b5094699038361912b19b0296f6d762b3da`): 114ms → 2ms. This measures JS subtree construction, not browser interaction latency.

401 image URLs: 154,579,674 original bytes → 43,608,514 variant bytes (71.8% reduction). Totals count referenced URLs, including identical image contents at different URLs. Content-hashed variants deduplicate storage. Six original URLs returned HTTP 400 and remain unchanged, with no variant manifest entry. No unverified substitute images were created.

These measurements isolate implementation effects. They are not promised production latency: user network, external PromptSpeed/Flash response times and Supabase load still apply.

## Validation and rollback

- All 542 behavior/isolated database tests passed, including request sharing/cancellation/identity isolation, full CRM lists, queue bounds, exact prices and remote-area calculations, Flash reconciliation, chat room/draft isolation and image fallback rules.
- Full CoreBiz + storefront build passed; storefront generated 730/730 pages in 73s. Final CoreBiz build repeated after tightening abandoned-read cancellation and passed.
- Lint: zero errors, three existing hook warnings in CustomerReorder, ProductGroupManagerModal and Ecommerce. Shipping Edge passed Deno type checking.
- No schema, RLS, JWT/authentication or provider mutation/retry changes. No dependency or paid service added.
- Revert the release commit to restore the frontend. The existing shipping-api v44 backup is retained locally for a scoped backend rollback. List variants are additive and can remain unused after rollback.
- Release identifiers and production checks are recorded with the PR and local deployment evidence.
