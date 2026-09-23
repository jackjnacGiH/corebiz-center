# Product suggestion scoring — 2026-09-23

Deployed to Supabase project `owoedccmuqnzdtxvywgt`: rag-chat v79 and line-webhook v42.

## Empty-answer incident and repair

- On 2026-09-23 at 17:47 and 17:48 Thai time, `jack●jnac` sent `SA331VC 5` and then a short follow-up. Both reached `rag-chat`, but Gemini returned zero completion tokens and made no tool call. The request was incorrectly recorded as `ok` with an empty answer, so LINE had nothing to send. The exact reason for Gemini's empty completion was not exposed by the stored telemetry.
- `rag-chat` now performs a catalog-only recovery if the model gives an empty answer with no tool call. For a product query it asks missing size/grit or offers only candidates that pass the existing 80-point selection gate. A short adjacent follow-up reuses only the immediately previous unanswered customer product query. If the catalog lookup fails, the bot asks the customer to resend details instead of returning an empty response.
- `line-webhook` also turns an empty successful `rag-chat` answer into a brief retry message, ensuring the chat is not silent if upstream recovery cannot produce text.
- The incident query has no stated grit, so recovery asks for it and never assumes SKU `2020000992` or its price.

## Behavior

- Preserve existing exact product lookup and customer-aware price verification.
- When exact lookup fails, rank candidates using fixed evidence points: model 30, type 25, size 20, grit 15, brand 10.
- Matching numeric model root with an unconfirmed suffix earns 15/30 model points. Generic sandpaper matched to a sanding disc earns 20/25 type points. Neither is treated as an alias or exact identity.
- Missing evidence earns zero; score is not an AI confidence/probability.
- Reject detected model, SKU, family, type, size, grit, holes, backing and recognized-brand conflicts before offering candidates.
- Offer up to three candidates scoring at least 80, always as a numbered customer confirmation. Even a single option has a LINE Quick Reply sending the exact catalog name.
- No price/quotation/lead/billing action while selection is pending. Existing get_exact_price controls remain in place after exact SKU selection.
- Model discovery is bounded to 1,000 active same-root rows. Non-model fallback uses at most 30 fuzzy candidates; absent model evidence alone cannot reach 80 with these fixed weights.

## Incident replay

Input: `กระดาษทราย DEERFOS SA331VC 5" #1500`

Against 189 current SA331 catalog identities, only `2020000992` qualifies: model 15 + type 20 + size 20 + grit 15 + brand 10 = 80.

The response explicitly says the requested model is SA331VC while the catalog model differs, and presents `1. กระดาษทรายกลมสักหลาด SA331 5" #1500` for selection. Selecting that name resolves the exact SKU through the unchanged strict path.

## Validation

- 30 tests passed: prior scoring checks plus empty-completion recovery for the exact incident, its short follow-up, and a complete 80-point query.
- Integration replay compiles the full rag-chat source and executes findProducts with a database adapter over the 189-row live catalog snapshot. It verifies the original clarification path, correct #150 versus #1500, exact selection and rollback flag.
- Edge deployment bundling succeeded. Retrieved deployed files match release sources; both functions ACTIVE and OPTIONS HTTP 200.
- No live customer conversation was sent. LLM/image extraction and the full LINE round trip have not been replayed against production. Web UI build is not applicable to this backend-only change.

## Source and rollback

The change was prepared in an isolated worktree based on the latest `origin/main`. The main workspace and user edits were preserved. The repository already contains the same rag-chat v77 and line-webhook v40 baseline that was running before the score release.

Set `PRODUCT_SCORE_SUGGESTIONS_ENABLED=false` to disable the scored fallback. To roll back the empty-answer repair as well, redeploy the function source from the parent commit on `origin/main` before this change. No schema, catalog, prices or synonym records changed.

Tests: `node --test tests/product-match-score.test.mjs tests/product-score-integration.test.mjs` (esbuild must be available; this worktree used the existing main workspace node_modules via NODE_PATH).
