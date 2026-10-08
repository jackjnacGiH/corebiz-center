# Sales transaction and stock rollout

Audit coverage: F07–F10, F12 and the sales pagination part of P3.

Apply `20261008051453_atomic_sales_stock_loyalty.sql` and
`20261008052337_sales_document_pagination.sql` before deploying the frontend or
the storefront quote Edge Function. The old client multi-write fallback is
removed deliberately: a missing RPC fails before any document is changed.

## Transaction and concurrency rules

- Quote creation, replacement of quote/order lines, and QT→Order conversion
  commit together with their totals. A failed line, totals update, shipping
  call, or final quote link rolls back the complete operation.
- Every header/line change increments the document version. Editors submit the
  version they loaded; another save/status/customer/line update causes an
  explicit reload conflict. Quote lines cannot be edited after conversion.
- Conversion locks the quote and has a unique source reference. Retries return
  the linked order; an old unlinked SO with the same code requires review.
- The portal response locks the quote. Opposing accept/reject requests cannot
  leave a task and quote with different responses. Repeating the winning
  response does not create another task or audit event.
- Saved revisions retain the old header, lines and price provenance. Provenance
  remains on an unchanged line; a changed price/quantity/product becomes a
  manual line and does not inherit a stale pricing fingerprint.

## Stock and historical orders

The default warehouse is chosen once for a new order. Matching product/variant
rows are locked in a stable order. Duplicate SKUs are aggregated. Available
stock excludes existing reservations; the ledger records requested, actually
deducted, and backorder quantities. Status changes and edits reconcile the final
set of lines, so intermediate delete/insert operations do not restore and
re-deduct stock.

For example, stock 5/request 10 records deduction 5/backorder 5; cancellation
returns 5. Stock 0/request 100 returns 0 on cancellation. Changing the default
warehouse later still restores to the original warehouse. Custom/shipping
lines with no product never touch stock.

**The migration never changes historical balances.** Existing orders retain
`stock_ledger_version=0`. They can progress between processing/shipped/delivered,
but cancelling/reopening or editing their stock demand requires an Owner/Admin
review. This avoids guessing whether the old broken trigger ever deducted them.

The owner can inspect the read-only queue with:

```sql
select * from public.sales_stock_review_queue();
```

For each legacy order, review its original warehouse, item quantities, movement
records and physical stock. Submit the verified quantity that was actually
deducted, **not** the order's requested quantity, with the current document
version and a review note to `baseline_order_stock(order_id, allocations, note,
expected_version, warehouse_id)`. The optional warehouse identifies the actual
historical warehouse, even if it is no longer the default. Each allocation contains `product_id`, optional `variant_id`
and `deducted`. The RPC records the baseline and audit evidence without changing
inventory; only later status/item changes use that baseline. A stock correction
is a separate, reviewed inventory action.

Before applying, duplicate inventory rows or duplicate earn-order awards cause
the migration to stop with a review error. It never deletes or merges those
records automatically. Stock metadata is managed by server functions; clients
cannot mark an unreviewed order as already baselined.

## Loyalty policy approved by Boss jack

One tier-multiplied award is recorded per order. Cancellation or the full-refund
payment status (`refunded`) reverses the exact recorded award once. Physical
`returned` status alone does not reverse points until full refund. A partial
payment/refund does not trigger full reversal. A reversed order cannot earn the
same points again by toggling paid/unpaid.

If the awarded points were already redeemed, the balance can become negative;
subsequent earnings offset the debt. Existing historical awards and balances
are not rewritten. The old duplicate loyalty trigger is removed; customer
spending totals continue to be recalculated.

## Pagination and measurement

The unified sales page requests at most 100 documents, searches and filters on
the server, and shows total counts plus a load-more button. The cursor includes
created time, ID and document kind. Cache keys include the search/status query;
late first-page or next-page results cannot overwrite a different query.

The isolated EXPLAIN fixture uses 50,000 equal-timestamp records and LIMIT 100.
The old created-time index requires scanning 50,000 rows to sort the ID tie
break; the `(created_at DESC,id DESC)` index reads 100. Actual timing is emitted
by the test and is a local fixture result, not a production speed guarantee.
Live metadata also confirmed that `quotes_code_unique_idx` duplicates the
constraint-owned `quotes_code_key` and has no dependants. The migration rechecks
the valid btree key, opclasses, collation, sort options, predicate, constraint and
dependencies before dropping only that redundant index; any mismatch stops for
review. The unique quote-code constraint remains. Other indexes and database
maintenance are not changed automatically.

## Verification

`node --test tests/sales-transactions-database.test.mjs
tests/list-page-loaders.test.mjs` exercises SQL roles, retries, rollback faults,
version conflicts, duplicate SKUs, reservations, zero stock, variants, original
warehouse restoration, loyalty reversals/debt, opposing quote responses,
service-only storefront shipping, >1,000-row traversal and UI request races.
PGlite queues one PostgreSQL session; these tests verify single-winner semantics
and actual lock SQL, but a staging multi-session lock-contention check remains
part of deployment acceptance.

No production document, balance or shipment is created by these tests.
