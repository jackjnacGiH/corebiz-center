# Chatbot customer memory and FlowAccount rollout

Production checklist for the customer-aware LINE chatbot. The release keeps
Gemini as the conversation model and keeps the current chatbot available behind
independent rollout flags.

## Scope (13 items)

1. Record the current production source, schema, error rate and response-time baseline.
2. Keep Gemini 2.5 Flash as primary and Flash-Lite as fallback. Build memory locally from sanitized customer slots and tool results, with no second model request.
3. Accept customer identity only from a trusted internal conversation linked to exactly one verified customer.
4. Store a bounded, redacted memory per conversation; never share memory across rooms.
5. Preserve current-turn details, confirmed product needs and recent six-month customer activity.
6. Ask only for missing product fields such as size, grit, unit, quantity, machine and application.
7. Resolve price in this order: active customer net price, eligible FlowAccount history, Tier, current normal product price.
8. Sync only normalized six-month FlowAccount price history for verified LINE customers who actually messaged within 180 days into a private cache; keep OAuth tokens in Vault.
9. Create/reuse quotations in CoreBiz with price snapshots and idempotency; do not create FlowAccount documents.
10. Keep the existing staff handoff and expose the room memory for staff review and locking.
11. Gate structured memory and FlowAccount cache independently, fail closed and preserve the current fallback path.
12. Run database, Edge, security, pricing, chat, shipping, build, Preview and Production checks before full enablement.
13. Update the in-app staff manual only after the production behavior is verified.

## Production acceptance gates

- No secrets, tax IDs, phone numbers, email, addresses, prices, stock, payment data or raw transcripts in conversation memory.
- Structured memory adds no extra model request, token charge or wait on the customer reply path.
- An older or slower turn cannot overwrite a newer turn; a staff-locked memory cannot be overwritten by the bot.
- A price is never stated unless the exact SKU and quantity resolve through the authoritative pricing RPC.
- FlowAccount import must complete as one immutable generation; a partial/failed run cannot affect pricing.
- The active FlowAccount cohort is selected from actual inbound LINE messages and contains the 100 most recently active exact verified customers at most. Empty cohorts skip provider reads; older eligible customers enter a later cohort when they message again.
- Baseline for the seven days before rollout: 304 successful Gemini runs, total response time p50 6.465 s and p95 14.084 s; end-to-end p50 11.146 s and p95 22.483 s.
- The rollout must not materially regress the baseline or the Shipping initial/full-reload path. Any regression, error-rate increase, identity ambiguity or stale cache disables the new flag and returns traffic to the current path.

## Edge gateway and tenant configuration

- Deploy `flowaccount-mcp-oauth-start` with Supabase JWT verification enabled.
- Deploy `flowaccount-mcp-oauth-callback` with gateway JWT verification disabled because the GET request comes from the FlowAccount OAuth provider. The function still requires a short-lived, single-use state and PKCE verifier.
- Deploy `flowaccount-price-sync` with gateway JWT verification disabled because the hourly database job authenticates with the private `x-flowaccount-sync-key`. Manual calls still require an active owner/admin JWT inside the function.
- Set `FLOWACCOUNT_MCP_EXPECTED_COMPANY_NAME` to `บริษัท เจ แนค (ประเทศไทย) จำกัด` and, when available, set `FLOWACCOUNT_MCP_EXPECTED_COMPANY_ID`. The callback must reject another selected company before storing provider tokens.
- Apply the pricing migration first, deploy the three FlowAccount functions while they are still unused, then apply the memory/sync migration that creates the hourly schedule. Deploy the updated `rag-chat` and `bot-learning-admin` only after both migrations are present. Start OAuth last, and verify gateway flags from deployed metadata rather than only from the deploy command.

## Rollback controls

- `structured_memory_enabled=false` disables the new structured memory and trusted customer context.
- FlowAccount sync/cache stays disabled until a complete eligible generation is published.
- The existing global, channel and conversation bot switches continue to take precedence.
- Disconnecting FlowAccount stops using its cached history without deleting CoreBiz quotations.
