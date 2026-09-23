# Guided catalog selection — 2026-09-23

Deployed to Supabase project `owoedccmuqnzdtxvywgt`: rag-chat v82 and line-webhook v44.

The LINE bot now uses current catalog matches to lead an adhesive sanding-disc conversation:

1. A broad request for adhesive-backed sandpaper, including the observed `หลังกาาว` typo, lists the available PS36 and MIRKA GOLD 5-inch catalog families as numbered choices.
2. Selecting a family lists its actual grits. LINE Quick Replies show short model/grit labels and send the full catalog choice; a typed option number also works for the immediately preceding list.
3. Once one exact SKU is selected, the bot shows freshly queried stock and asks for quantity. It calls `get_exact_price` only with that SKU and a valid quantity, then asks whether the customer wants a quotation. A short affirmative answer to that immediate question uses the existing `request_quote` safeguards, including the CRM tax-ID requirement; no quote is made while product selection is pending.
4. If a requested grit is unavailable, the bot shows verified choices without claiming the whole product family is unavailable. It routes to staff when the customer insists on the unavailable specification.

The 80-point scored-candidate gate remains for near matches such as SA331VC versus SA331. Family and grit choices are navigation through active catalog rows, not a claim that a partial request identifies one SKU.
For other named product types, the bot prompt now directs `find_products` before broad category tools; numbered catalog model choices are only offered when the bounded scan is complete.

Production catalog data has 7 active PS36 adhesive 5-inch grits and 11 active MIRKA GOLD adhesive 5-inch grits. Some PS36 rows have an English title saying `Velcro` while their Thai customer-facing title says `หลังกาว`. Matching uses the Thai title when present. The catalog wording should be reviewed separately; no product record was edited in this release.

`PRODUCT_GUIDED_SELECTION_ENABLED=false` restores the previous model-led path. No schema, stock, price, or catalog data was changed. Targeted tests cover the screenshot replay, option selection, missing #800, the MIRKA spelling, quantity carry-forward, pricing safeguards, quote consent, and LINE button labels.

Validation: 94 related tests passed; both Edge sources bundled successfully. Retrieved deployed files match the release bundle, both functions are ACTIVE, and both OPTIONS checks returned HTTP 200. No message was sent to a live customer as a test.
