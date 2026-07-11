# CoreBiz Center Monorepo

CoreBiz Center is the production monorepo for JNAC's public storefront and back-office admin center.

## Active applications

- `apps/storefront` — public Next.js storefront, served at `/`.
- `frontend` — CoreBiz Vite/React admin center, served at `/center`.
- `supabase` — database migrations and active Edge Functions such as `rag-chat`, `line-webhook`, and inventory sync.
- `jnac info_Assist` — source artifacts for product and knowledge-base imports; it is not a deployed service.

The production domain is `https://www.jnac.online`. The old `corebiz.online` domain remains a Vercel alias during the transition.

## Commands

Run from the repository root:

```bash
npm install
npm run dev:storefront
npm run dev:corebiz
npm run lint
npm run build
```

## Architecture boundaries

- Public commerce pages live in `apps/storefront`.
- Staff administration lives in `frontend`.
- AI knowledge search and customer chat use the CoreBiz Supabase project and its Edge Functions. There is no local Express RAG service.
- The former JNAC Admin Chat application is not part of the active monorepo or Vercel Services configuration.

## Environment

Keep service-specific variables in local environment files or deployment settings. Never commit `.env`, `.env.local`, `.vercel`, `.next`, `dist`, `node_modules`, or credentials.

## Vercel deployment

The repository deploys to the Vercel project `corebiz-center` using Vercel Services:

- `shop`: `apps/storefront` at `/`
- `corebiz`: `frontend` at `/center`

Vercel project settings must use the repository root and the Services framework. GitHub Actions deploys `main` through `.github/workflows/deploy.yml` after lint and build pass.

Required GitHub repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_COREBIZ_PROJECT_ID` or the legacy `VERCEL_PROJECT_ID`

External legacy projects, hosting subscriptions, and old domains are retained until the owner separately approves deletion or cancellation.
