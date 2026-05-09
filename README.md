# CoreBiz Center Monorepo

CoreBiz Center is the main workspace. CoreBiz and JNAC Admin Chat are deployed through the single Vercel project `corebiz-center` using Vercel Services.

## Workspaces

- `frontend` - CoreBiz Center Vite/React admin shell.
- `api` - Openclaw RAG Express API used by the CoreBiz RAG screen.
- `apps/jnac-admin-chat` - JNAC Admin Chat Next.js app with Supabase Auth, product/price search, chat history, and sheet sync.
- `jnac info_Assist` - JNAC crawl, document, CSV, JSONL, and sheet sync source artifacts.

## Commands

Run these from the repository root:

```bash
npm run dev:corebiz
npm run start:api
npm run dev:jnac
```

Build and lint can also be run from the root:

```bash
npm run build:corebiz
npm run build:jnac
npm run lint
```

## Integration Rule

For this phase, CoreBiz Center is the central repo and navigation shell, while `jnac-admin-chat` remains a standalone module under the same Vercel project. Do not move its Next.js API routes, Supabase logic, auth flow, or sync logic into the Vite frontend yet.

JNAC Admin Chat is mounted at `/jnac` on the CoreBiz domain. After that is stable, shared auth, shared Supabase schema, and API consolidation can be planned as separate migrations.

## Environment

Keep app-specific environment variables in each app's local environment files or deployment settings. Do not commit `.env`, `.env.local`, Vercel metadata, `.next`, `dist`, or `node_modules`.

Openclaw RAG API local env variables are documented in `api/.env.example`:

- `OPENCLAW_SUPABASE_URL`
- `OPENCLAW_SUPABASE_ANON_KEY`
- `PHAYA_API_KEY`

## Vercel Deployment

This repo deploys to one Vercel project:

- CoreBiz Center: `corebiz-center`, root directory repo root, production URL `https://www.corebiz.online`
- CoreBiz Vite shell route: `/`
- JNAC Admin Chat Next.js route: `/jnac`

Vercel project settings must use:

- Framework Preset: `Services`
- Root Directory: repo root / blank

GitHub Actions deploys the unified project from `.github/workflows/deploy.yml`. Required GitHub repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_COREBIZ_PROJECT_ID` or the legacy `VERCEL_PROJECT_ID`

Current Vercel project id from the linked local workspace:

- `corebiz-center`: `prj_RgkMC07bPnjK0v9RH1491PC0yMKa`

Do not delete the old `jnac-admin-chat` Vercel project until `https://www.corebiz.online/jnac` is verified in production.
