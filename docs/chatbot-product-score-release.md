# Product suggestion scoring — 2026-09-23

Deployed to Supabase project `owoedccmuqnzdtxvywgt`: rag-chat v80 and line-webhook v43.

## Empty-answer incident and repair

- On 2026-09-23 at 17:47 and 17:48 Thai time, `jack●jnac` sent `SA331VC 5` and then a short follow-up. Both reached `rag-chat`, but Gemini returned zero completion tokens and made no tool call. The request was incorrectly recorded as `ok` with an empty answer, so LINE had nothing to send. The exact reason for Gemini's empty completion was not exposed by the stored telemetry.
- `rag-chat` now performs a catalog-only recovery if the model gives an empty answer with no tool call. For a product query it asks missing size/grit or offers only candidates that pass the existing 80-point selection gate. A size/grit-only answer to the preceding product clarification retains that product identity and the customer's Thai language. If no product can be resolved, the bot asks for the missing detail without the generic English failure message.
- `line-webhook` also turns an empty successful `rag-chat` answer into a brief Thai request for detail, ensuring the chat is not silent if upstream recovery cannot produce text.
- The incident query has no stated grit, so recovery asks for it and never assumes SKU `2020000992` or its price.

## Behavior

- Preserve existing exact product lookup and customer-aware price verification.
- When exact lookup fails, rank candidates using fixed evidence points: model 30, type 25, size 20, grit 15, brand 10.
- Matching numeric model root with an unconfirmed suffix earns 20/30 model points. Generic sandpaper matched to a sanding disc earns 20/25 type points. Neither is treated as an alias or exact identity.
- Missing evidence earns zero; score is not an AI confidence/probability.
- Reject detected model, SKU, family, type, size, grit, holes, backing and recognized-brand conflicts before offering candidates.
- Offer up to three candidates scoring at least 80, always as a numbered customer confirmation. Even a single option has a LINE Quick Reply sending the exact catalog name.
- No price/quotation/lead/billing action while selection is pending. Existing get_exact_price controls remain in place after exact SKU selection.
- Model discovery is bounded to 1,000 active same-root rows. Non-model fallback uses at most 30 fuzzy candidates; absent model evidence alone cannot reach 80 with these fixed weights.

## Incident replay

Input: `กระดาษทราย DEERFOS SA331VC 5" #1500`

Against the 189-row SA331 catalog snapshot, only `2020000992` qualifies: model 20 + type 20 + size 20 + grit 15 + brand 10 = 85. Without a stated brand, the explicit Velcro sanding-disc type earns 25 and totals 80.

The response explicitly says the requested model is SA331VC while the catalog model differs, and presents `1. กระดาษทรายกลมสักหลาด SA331 5" #1500` for selection. Selecting that name resolves the exact SKU through the unchanged strict path.

If the customer answers `5" #1500` after the SA331VC clarification, recovery searches with the preceding product identity and offers the same catalog candidate. If they ask `รุ่น SA331 5" มีเบอร์อะไรบ้าง`, recovery removes conversational filler, lists the available catalog grits, and identifies the SA331 5-inch backing as Velcro. Adhesive-backed discs are separate models and must not be presented as SA331 variants.

## Validation

- 32 tests passed: prior scoring checks plus the numeric-only follow-up and SA331 5-inch grit-list regressions.
- Integration replay compiles the full rag-chat source and executes findProducts with a database adapter over the 189-row live catalog snapshot. It verifies the original clarification path, correct #150 versus #1500, exact selection and rollback flag.
- Edge deployment bundling succeeded. Retrieved v80/v43 files match release sources; both functions ACTIVE and OPTIONS HTTP 200.
- No live customer conversation was sent. LLM/image extraction and the full LINE round trip have not been replayed against production. Web UI build is not applicable to this backend-only change.

## Source and rollback

The change was prepared in an isolated worktree based on the latest `origin/main`. The main workspace and user edits were preserved. The repository matched the deployed rag-chat v79 and line-webhook v42 baseline before this follow-up release.

Set `PRODUCT_SCORE_SUGGESTIONS_ENABLED=false` to disable the scored fallback. To roll back the empty-answer repair as well, redeploy the function source from the parent commit on `origin/main` before this change. No schema, catalog, prices or synonym records changed.

Tests: `node --test tests/product-match-score.test.mjs tests/product-score-integration.test.mjs` (esbuild must be available; this worktree used the existing main workspace node_modules via NODE_PATH).
