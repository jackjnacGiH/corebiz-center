# Production State and Cleanup Guardrails

Verified on 2026-07-11 before the legacy-code cleanup.

## Active production

- Vercel project: `corebiz-center`
- Primary domains: `https://jnac.online` and `https://www.jnac.online`
- Legacy aliases retained: `corebiz.online` and `www.corebiz.online`
- Active application routes after this cleanup:
  - `/` — `apps/storefront`
  - `/center` — `frontend`
- CoreBiz Supabase project: `owoedccmuqnzdtxvywgt`

The Supabase database and Edge Functions are independent from a Vercel code deployment. Never deploy an Edge Function from the repo without first fetching and comparing the live version.

## Confirmed legacy code removed from this repo

- Dashboard `AI Workflow Assistant` / n8n webhook box
- Local Express RAG service under `api/` and its `localhost:3001` launcher
- JNAC Admin Chat application and Vercel Services route `/jnac`
- Unreferenced backup/template React files

The active knowledge-base screens remain. They use the CoreBiz Supabase RAG path (`knowledge_chunks`, `match_knowledge`, `rag-search`, `rag-chat`, and related Edge Functions), not the removed local Express server.

## External rollback assets retained

These are intentionally not deleted or cancelled by code cleanup:

- The separate legacy Vercel project `jnac-admin-chat`
- The inactive legacy Supabase project named `JNAC Admin Chat`
- Hostinger hosting and domain subscriptions
- The old `corebiz.online` domain aliases

Deleting projects, cancelling plans, or changing renewals requires separate owner approval because it can be irreversible or affect cost.

## Known schema and deployment drift

- Production migration history includes `0034_item_unit`, while the local numbered migration set has no `0034` file. Do not invent or rewrite an applied migration; recover its original SQL before filling that historical gap.
- Production migration history currently ends at `0070`. Local migrations `0071`, `0072`, and `0073` must be reviewed and applied through the normal migration workflow; this cleanup does not modify the live database.
- Production already has nullable numeric `org_settings.monthly_revenue_target` with default `2000000`; migration `0073` records that state idempotently.
- Live Edge Functions can be newer than repo copies. Treat the live source as authoritative before every function deployment.
