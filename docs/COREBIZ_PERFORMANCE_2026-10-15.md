# CoreBiz performance review — 15 October 2026

Scope: performance only, based on `cfd2f31`. Existing business calculations, permissions, forms, document actions and data remain the same. The main checkout contains unrelated edits; this work uses an isolated branch.

## Implemented

1. Defer CRM tool tabs and closed CRM/Inventory/Orders/Ecommerce dialogs until first use. `DeferredContent` keeps a tool mounted after first opening so closing/reopening retains its existing lifecycle and form state. Route navigation and the page shell keep the same behavior.
2. Cache the result of the existing statement-stable permission helpers within 13 list policies across products, inventory, categories, product groups, customers, customer branches, warehouses and notifications. Helpers, roles, actions, WITH CHECK conditions, public access and row predicates are unchanged. Profiles is excluded because of its existing same-table update check. Add an index matching the existing customer page order: `total_spent DESC, id ASC`.

The migration refuses unexpected policy/helper/index drift and rolls back the whole change. There are no package, infrastructure or subscription changes.

## Reproducible measurements

Bundle results include the route's recursive static JS dependencies, not just its own chunk. Baseline builds HEAD's original page sources with the same Vite configuration and installed dependencies, without editing the checkout. Counts exclude dynamic imports until used; gzip bytes are local gzip measurements, not network latency.

| Route | Before JS | After JS | Reduction | Gzip before → after |
|---|---:|---:|---:|---:|
| CRM | 1,398,535 B | 838,865 B | 40.0% | 403,197 → 253,090 B |
| Inventory | 926,938 B | 842,697 B | 9.1% | 277,283 → 253,666 B |
| Orders | 852,183 B | 796,187 B | 6.6% | 255,118 → 237,855 B |
| Ecommerce | 848,229 B | 830,740 B | 2.1% | 251,588 → 245,569 B |

The boot graph is essentially unchanged (775,638 → 775,602 B). Dashboard, Chat and Shipping retain their current loading logic.

Live database query measured with the same authenticated owner and SQL:

```sql
select * from public.customers order by total_spent desc,id asc limit 1000;
```

- Before: 272.103 ms, sequential scan of 3,428 authorized rows plus sort, 7,405 shared-buffer hits.
- After preview: 6.611 ms, index scan, 1,000 returned rows, 1,109 shared-buffer hits.
- Preview changes were tested in one transaction then rolled back. These are individual SQL samples, not p50/p95 page timings. See the full EXPLAIN JSON in `output/performance-2026-10-15/customer-query-preview.json`.
- Isolated PostgreSQL fixture: the same 5,000 authorized rows, 5,001 permission/identity calls → 1. Before/after equality is tested separately for owner, admin, staff, agent, viewer, customer, inactive and anonymous callers, including insert/update/delete outcomes.

Re-run:

```powershell
node scripts/build-performance-baseline.mjs
node scripts/measure-corebiz-performance.mjs before output/performance-2026-10-15/baseline-dist
npm run build:corebiz
node scripts/measure-corebiz-performance.mjs after
node --require ./scripts/test-network-guard.cjs --experimental-strip-types --test tests/corebiz-performance.test.mjs
```

## Other findings and next priorities

| Area checked | Evidence / recommendation |
|---|---|
| Auth/bootstrap | Existing bounded session/profile reads, account isolation and tests already exist. Keep verification intact. |
| Shared cache / Realtime | Existing request sharing and refresh queue already prevent many duplicate requests. Preserve invalidation after writes and account changes. |
| Layout prefetch | Four large lists are prefetched together after 2.5 seconds; CRM also has a separate cache. Next: measure and unify these reads or prioritize by navigation intent, retaining identical reload and account-isolation semantics. |
| Dashboard | `getKPI()` performs three independent reads sequentially; recent activity performs two. Next: parallelize the same reads and compare returned results. Avoid changing financial aggregation in a speed-only patch. |
| Products / Inventory / CRM | Large client-side lists and broad projections remain. Next: server-side pagination/projection with parity for full export, filters, selections, totals and product editing. Do not silently cap records. |
| Orders / shipping | Existing bounded pages and shipping session cache remain. Defer order detail code only. |
| Chat | Existing debounced inbox search, bounded messages, per-room cache and race guards remain. Measure room-switch rendering separately before adding more prefetch work. |
| Background integrations | Accumulated DB statistics show FlowAccount target lookup averaging 1,363 ms over 714 calls. Investigate its query plan separately; external requests and financial rules are outside this patch. |
| Database indexes | Advisor reports 52 uncovered foreign keys and 69 unused indexes. Treat these as investigation leads, not a reason to add/drop every index. Prioritize measured queries. |
| Rendering / chart/PDF tools | Routes are already split. Heavy charts/PDF work should remain on demand; do not load every route upfront. |

This review covers route/dependency loading, the shared data/API/cache paths, production SQL statistics and advisors. It is not a timed end-to-end benchmark of every interactive screen or third-party service.

## Validation and rollout

- Focused tests cover policy equivalence, all-or-nothing drift rejection, permission-call reduction, ordered customer-index results, and deferred tool lifecycle.
- Full local suite before the final index assertion: 526 passed. The index addition's focused suite: 5 passed. Final CI runs the complete suite.
- CoreBiz production build passes. ESLint has no errors and three existing warnings in CustomerReorder, ProductGroupManagerModal and Ecommerce.
- Roll out frontend and database changes separately. Web rollback: previous deployment/commit. Database rollback: `docs/corebiz-performance-rollback.sql`, restoring the exact preflight predicates and removing only the introduced index.

Sources: [Supabase RLS performance recommendations](https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations), [React lazy](https://react.dev/reference/react/lazy).
