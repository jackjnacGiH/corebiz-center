# OmniChat critical information and active-item context review

Code remains a review patch: no push, merge, migration or deployment. The
separately authorized company-name typo correction was completed through the
existing KB editor and the source Sheet QA!B4. No payment values, credentials,
permissions, customer or staff messages were changed. Both direct LINE OA and
OmniChat remain supported. Production protection is not active from this patch.

## Baseline and isolation

- Isolated checkout: `corebiz-review`, detached at
  `7f718fbceb0fa92b9ddd91bbf794b0d592965260`.
- GitHub `main` was checked read-only and matched that revision.
- Deployed `rag-chat` v103 and `line-webhook` v52 matched repository sources
  after CRLF normalization. Deployment preflight found Facebook v16 production
  safety/receipt changes absent from GitHub main. Those deployed files are now
  preserved, with only this task's quote/replay metadata guard and an explicit
  null check added. Production behavior is not reverted to the older repo copy.
- The original D: checkout had unrelated modified/untracked work and an older
  HEAD. It was not edited, reset, staged or switched.

## Scope 1: critical company and payment facts

`critical-company-info.mjs` is the only renderer for approved seller legal name,
registered address and receiving-bank details. Explicit Thai/English intents
run before retrieval, persona, callback, product and quotation decisions.
Values are concatenated exactly, without translation or model rewriting.

The source is the existing owner-confirmed KB and organization settings.
`org_settings.critical_company_master` stores schema-version-2 source references,
SHA-256 digests, exact code-point selectors and authenticated approval provenance;
it does not store another copy of company or banking values. The runtime rejects
legacy value snapshots. Names must agree byte for byte across organization,
payment and location sources. The registered address comes from `org_settings.address`,
including the exact spaced hyphen confirmed by the owner; the location prose is
not silently normalized into that field. Bank, account holder, number and type
are selected from the existing payment KB. All chunks of both source documents
are bound: changed IDs, timestamps, hashes, contents, visibility/language,
missing or added chunks, conflicting names and failed reads fail closed.

`critical-company-approval` is a new, undeployed authenticated owner endpoint:
POST `{"action":"preview"}` returns deterministic exact fields, draft source
bindings and a digest. POST `{"action":"bind","digest":"<preview digest>"}`
accepts only the already owner-confirmed source revision, re-reads it, and uses
the existing owner-only settings UPDATE under the owner's own session. The
invoker-security trigger checks actual actor identity and stamps approval time
and 90-day expiry; copied value fields are rejected. There is no new RPC or
permission grant. Existing settings RLS remains owner-only. A service-role
job alone cannot approve. Workspace settings includes an owner-only source
preview/binding control using the existing authenticated session. It displays
exact fields and the verified receipt; uncertain writes do not display success.
The owner need not retype or reconfirm values.

The reviewed, unapproved reference manifest is
`docs/critical-company-source-binding-reviewed.json`; it records the two owner
confirmation message references and no bank numbers. Its source digest is pinned
in the endpoint. Source values were confirmed in the conversation, but no
authenticated application approval record has been written. Future changed
source revisions require a newly reviewed binding, not reuse of those confirmations.
Preparation and preview never authorize replies. Missing approval, inactive
approver, expiry and unsafe output characters all fail closed to staff review.
QR assets and tax IDs remain unsupported. No LLM, memory, OCR or retrieval rank
can establish an approved value.

Generated critical claims and critical tool notes are discarded. The outer
response gate covers deterministic early exits as well as model text, before
the final message is persisted or emitted. Critical source previews/tool
metadata are withheld too. Real catalogue SKUs are excluded from the generic
long-number detector so product responses continue to work.

Slips/ambiguous images are classified within the existing generation/tool
loop; there is no extra classifier API request or model upgrade. Missing or
invalid classification stops tools. Receipt responses cannot repeat OCR data,
claim accounting receipt, or confirm payment. Product, billing and purchase
order classifications retain their existing guarded workflows.

Review requests use the existing staff-visible agent queue with dedicated
`ops.critical_company_review` tasks, conversation links, SHA-256 content/image
dedupe keys and a readback of the returned task ID, kind, conversation and
dedupe key. Replies distinguish queued/pending staff acceptance, recorded
staff acceptance, failed/terminal tasks, uncertain receipts, and read-only
evaluation. A queued proposal is never described as accounting acceptance.
Repeated identical closed tasks are not silently reopened or called delivered;
they produce an explicit failure/unknown state for staff follow-up.

LINE no longer replaces slip language with a fabricated accounting success.
The server's `verbatim` response flag bypasses LINE text/quote transformations;
Messenger also suppresses unrelated quote-link appends for protected replies.
No master output uses Markdown, URLs or other fields which would be rewritten
by the existing web/Messenger renderers.

## Scope 2: active item, language and concurrency

`active-item-context.mjs` reduces a bounded 64-message evidence window into
one active item, quote intent and requested specification/quantity/unit slots.
Each known value records its customer or catalogue provenance. Missing and
conflicting slots remain explicit; conflict evidence retains both values.
Billing/payment text is excluded from product facts. Arbitrary learned
summaries and generated SKU prose do not establish catalogue identity.

- `ค่ะ ต้องการ 10 ตัวค่ะ`, `ต้องการ 10 ตัวค่ะ`, pieces, packs and similar
  short replies retain the active topic. Genuine new topics clear old facts;
  multi-item ambiguity asks which item rather than guessing.
- Official `/p/<sku>` customer links resolve by a fresh exact catalogue lookup,
  even when the earlier bot answer has not arrived.
- Dimensions such as `31.5x10x3.17` and `30x10x3` are not model codes or SKUs.
- URLs, SKUs, dimensions and technical unit tokens do not establish English.
  The latest meaningful customer language is retained.
- Text and image results carry only server-verified single-SKU metadata into
  the next turn. It still requires a fresh lookup; no price/availability is
  carried as a historical fact.
- The model receives the small evidence summary and bounded recent turns,
  rather than the entire 64-message window or dirty model memory.
- Pack versus piece quantities cannot be interchanged. Conversion requires
  current structured catalogue `spec.pieces_per_pack`; uncertainty or a linked
  SKU/spec mismatch creates an `ops.chat_followup` task with the known facts.
- A text billing reply can continue a genuine pending customer quotation;
  existing server CRM/billing checks and quote idempotency remain authoritative.
  A billing document without prior consent cannot authorize a quote.
- Human requests use receipt-backed queue status with the actual known specs.

`conversation-turn-lease.mjs` uses an atomic compare-and-swap on the existing
conversation row, shared across Edge isolates. LINE holds the lease through
inbound storage, history, RAG, final bot checks and delivery completion; RAG
validates the inherited server token. Direct RAG callers acquire their own
lease. Generated text is not persisted or published after the lease is stale
or the conversation bot is disabled. Lease release cannot clear a newer token.
Background learned-memory writes retain their existing timestamp safeguards
and no longer supply factual prompt continuity.

The lease is 120 seconds with a 30-second acquisition wait. A busy/missing
schema fails closed; the existing durable delivery ledger exposes retry or
review rather than executing another overlapping tool flow. Serialization
does not guarantee timestamp order for externally delayed/reordered webhook
delivery. Ambiguous/missing item context must still be clarified.

## Native LINE OA limitation and proposed workflow (not implemented)

Recorded OmniChat staff sends are stored as `sender_type='agent'`, with delivery
metadata, and remain in ordered history as `[เจ้าหน้าที่]`. A native OA Manager
reply is not assumed to exist in CoreBiz. There is no scraping, unofficial
integration, paid package, automatic native-message detection or forced channel
migration in this patch.

Official public Messaging API docs describe inbound user-message webhooks and
content retrieval, not a native OA staff-outbound transcript/history endpoint:
[receiving messages](https://developers.line.biz/en/docs/messaging-api/receiving-messages/),
[API reference](https://developers.line.biz/en/reference/messaging-api/).
The [OA Chat Package manual](https://lineforbusiness.com/files/OA%20Chat%20Package_Manual_Final%20FEB2025.pdf)
describes manual export; account entitlement/realtime sync is not established.

For owner review only: use the existing per-conversation bot switch while staff
works in OA, then optionally record a short, attributed context-return note in
CoreBiz before re-enabling. No new takeover or manual-note workflow was built,
because that portion requires the owner's choice. Native OA context stays
explicitly unknown until a supported source or operator-provided context exists.

## Validation and remaining limits

All application/provider/customer messaging I/O in replay tests is synthetic.
The migration tests run against a temporary local PostgreSQL-compatible engine,
not Supabase. Fixtures contain no real bank numbers or production master data.
See the task-level verification logs and combined patch for exact test counts.
Final checks: all 606 repository tests passed with no failures or skips; the
focused combined suite passed 48 tests, with overlap. A final approval-receipt
check also passed after adding missing-receipt rejection. Deno checked all four
changed Edge Function entry points; targeted
JavaScript lint and repository lint passed (three existing React-hook warnings).
The final CoreBiz TypeScript/Vite build passed. `git diff --check` and applying
the combined patch with `git apply --check` against the clean baseline passed.
No live provider or staging deployment verification was run. The separately
authorized production content correction was read back and retrieval-verified.

The storefront source/dependencies were not changed. The isolated review build
initially hit a Turbopack CSS-worker startup failure. A controlled comparison
verified matching lockfile, Next config and relevant installed dependency hashes,
then archived only the review checkout's generated `.next` cache. Both that
clean review build and the independent unchanged baseline compiled, type-checked
and generated all 730 pages, then exited at the same Next.js
`SecurityFatalError` upgrade gate. The worker error did not recur under equivalent
clean build conditions; no source/dependency/security-setting change was needed.
The first baseline attempt used a dependency junction which Turbopack rejected;
that invalid comparison was replaced by the independent install. Neither
failure is a demonstrated code regression from this patch; full storefront
build success remains unverified. No dependency/security upgrade was attempted.

The adversarial follow-up checks Unicode/zero-width/spaced critical requests,
conflicting image category signals, forged browser catalogue metadata, invalid
partial master approval and persistence/SSE leaks. Detection normalization is
used only for deciding whether to block; approved output strings remain exact.

### Source confirmation and application binding

All requested name/address/bank fields are confirmed by the owner; no further
source-value input is needed. Read-only preparation against current source
revisions succeeded. Remaining rollout actions are technical: review and stage
the patch, deploy only after authorization, then perform the authenticated
source binding and verify its receipt and exact output. None has been executed.
The empty draft template is obsolete; use the reviewed source-reference manifest
and endpoint rather than manual duplicate entry.

### Narrow production content correction and legacy limitation

The supported KB editor rebuilt all three location chunks at
2026-10-24T10:47:49.063483+00:00. Only `แจ` to `เจ` changed; index-1 hash
470579e9 became bdd583cc. Index-0 and index-2 contents/hashes and all metadata
were preserved. Stored-embedding vector retrieval returned the corrected chunk
at similarity 1.0. The source Sheet QA!B4 was corrected with a content-only cell
update and read back; neighboring cells/formatting were preserved.

Legacy `page_sections` row 81 still has the typo. Its metadata points to that
Sheet, but no supported re-ingestion/update route is verified. Repository code,
stored-function references and cron inventory did not identify one; deployed
phaya-embed, openai-embed and rag-search also contain no page_sections reference.
It was not directly SQL-updated, because that would bypass embedding/source
integrity. Completion of that legacy copy is pending identification of its
external ingestion owner/workflow; no new integration or broad rewrite was made.

### Staging prerequisites still required

A separately authorized non-production Supabase environment with the existing
CoreBiz schema, two additive migrations and authenticated test owner/admin/staff
identities is needed. Use synthetic master values and customers, a local/fake
messaging endpoint or isolated test OA/Messenger recipients, and the existing
model only if staging provider testing is separately authorized. Verify owner
approval rejection/acceptance, queue read visibility and status transitions,
expired/missing/conflicting master data, actual renderer output equality,
concurrent/reordered events, lease expiry/busy recovery, staff bot-switch
cancellation, prepared-reply recovery and billing/quote idempotency. Current
tests mock all model/provider/customer messaging I/O; no production writes or
live customer sends are needed to complete this validation.

Text intent/claim detection and image classification are not a mathematical
proof over arbitrary adversarial language/images. Missing classification fails
closed, but false classification remains a staging/adversarial validation risk.
Prepared critical bot replies, including legacy bank/handoff claims, are held
in the durable delivery ledger for staff review instead of bypassing the new
guard on an automatic replay. Explicit human-authored message retries retain
their existing staff path. There is no live provider/end-customer validation
in this work.

## Unexecuted rollout and rollback plan

Production deployment was subsequently authorized. Preflight confirmed remote
main remains at the reviewed base, RAG v103/LINE v52 still match it, and the
owner-confirmed source digest is unchanged. Messenger v16 production drift has
been preserved locally. No production mutation has yet been submitted.

The owner subsequently approved the minimal security dependency fix. Next.js
and matching eslint-config-next are pinned to 16.4.1, the patched 16.4 version
identified by https://nextjs.org/blog/nextjs-security-update-october-14-2026 .
Only the Next package family changed in the lockfile; React stayed unchanged.
A clean npm ci, all 606 tests, repository lint, CoreBiz build and ordinary
network-enabled storefront build now pass. No security bypass was used.
An existing zod 4.6.5 development-only advisory is outside this minimal Next fix;
no broad npm audit fix or unrelated dependency upgrade was performed.
The previous new-RPC grant requirement was eliminated by reusing the existing
owner-only settings UPDATE policy; the binding trigger verifies actual identity
and stamps time/expiry. No new grants or policy changes are required.

1. Review this combined patch, queue behavior, limits and master source contract.
2. In an authorized staging environment, apply the two additive migrations,
   check the existing singleton/conversation schema and run the replay suite.
3. Bind the already confirmed source revision through the authenticated owner
   endpoint after authorization; verify the returned actor/time/expiry receipt.
   No re-entry or repeated confirmation of source values is needed.
4. Verify adversarial receipts, native-OA gaps, lease expiry/busy recovery,
   real agent-queue visibility and the deployment's actual LINE/Messenger paths.
   Review legacy prepared delivery messages before any replay.
5. Only with separate authorization, deploy coordinated RAG/webhook changes
   and the staff queue labels. Push, draft PR, merge and production actions are
   not authorized by this task.

The additive migrations can remain during code rollback; no destructive schema
rollback is needed. For an urgent safety rollback, use the existing bot switches
to pause affected conversations/channels and let staff handle them. Reverting
to the old RAG/LINE versions would reintroduce the known critical-data bug and
must not be treated as a safe return to unrestricted automated replies. An
approved master can be deactivated/expired only by a separately authorized
operator; that causes this patch to fail closed to staff review.
