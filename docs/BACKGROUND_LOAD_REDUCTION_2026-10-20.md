# Background load reduction — 20 October 2026

Approved scope: reduce repeated background work; preserve shipping, Omni-Chat,
stock/pricing freshness checks, permissions, formulas and the current Supabase plan.

## Changes

1. The hourly FlowAccount dispatcher skips `oauth_configuration_invalid` until
   reconnection clears that error. It creates one in-app notification per active
   owner/admin per error occurrence. Manual sync still calls the same endpoint.
   Transient provider errors retain their existing hourly retry. This does not
   repair the OAuth configuration or make expired customer prices valid.
2. `agent_propose` only updates open proposals when their displayed contents or
   priority change. Closed proposals and the shared bot/quote/contact task queue
   retain their existing behavior. AI scan and monthly review frequencies remain.
3. Completed inventory-sync and cron histories older than **60 days** are archived
   as lossless gzip JSON in the **private** `maintenance-history` Storage bucket.
   Every file is downloaded again and its SHA-256 and length verified before any
   deletion. Deletion matches the full archived row, so concurrent changes survive.
   Active/incomplete runs, recent history and business records are never pruned.
   An internal manifest records file paths, checksums, bytes and deleted counts.
   The nightly job runs at **03:23 Asia/Bangkok**, bounded to 2,000 rows per call.
   Upload, verification or quota errors stop that batch without pruning it.
   Archives are retained; no automatic archive deletion is added.
4. Dashboard, Inventory and Ecommerce defer Realtime-triggered reads while the
   browser tab is hidden, then refresh once when visible (including missed-event
   recovery). Active reads, foreground behavior and subscriptions are retained.
   Shipping and Chat do not opt into this gate.

## Baseline and focused checks

- Live pre-change AI proposals updated unchanged open rows on every call. The
  isolated database check confirms a duplicate now causes **zero** updates while
  real changes still update and return the same proposal ID.
- 100 sequential hidden refresh requests previously caused 100 reads; the new
  visibility gate causes **zero hidden reads and one read on return**. Existing
  refresh queue tests preserve foreground bursts, errors and StrictMode cleanup.
- Live inventory sync already skips unchanged stock. Its 15-minute cadence and
  hourly expired-conversation cleanup are untouched.
- Archive tests cover round-trip Thai JSON, upload/read/checksum failures, missing
  objects, archive-only mode, recent/incomplete rows, concurrent changes, retries,
  and denied access for ordinary authenticated users.
- Production latency improvement must be measured separately; these counts are
  reproducible behavior checks and are not a claim about every live request.

## Release order and rollback

1. Run isolated DB/helper/visibility tests, full suite, Edge type check, lint/build.
2. Apply the migration and deploy `archive-maintenance-history`. The new cron is
   **inactive** until the endpoint and the first archive-only backups are verified.
3. Run archive-only first, inspect private bucket and manifest, then drain the
   initial backlog through bounded verified batches. Activate the nightly cron.
4. Release the reviewed frontend through PR/Preview/main; verify authenticated
   Dashboard, Inventory, Ecommerce, Shipping and Chat on Production.

Rollback: deactivate `history-archive-daily`, restore the previous two SQL function
definitions from the release backup, and revert the scoped frontend commit. Do
not delete the bucket or manifests. Download gzip files with authorized Storage
access and decode their JSON arrays to restore original history rows using
`jsonb_populate_recordset(null::public.inventory_sync_logs, ...)` or
`jsonb_populate_recordset(null::cron.job_run_details, ...)` and `ON CONFLICT DO
NOTHING` in an administrator-reviewed transaction. No business tables need restore.

The dedicated archive key is generated in Vault, never committed or returned to
the browser. Archive RPCs are service-role-only. No paid service or plan change is
part of this release.
