# CoreBiz Center Monorepo

CoreBiz Center is the main workspace. The current merge keeps each existing project operational as its own workspace instead of migrating code between stacks immediately.

## Workspaces

- `frontend` - CoreBiz Center Vite/React admin shell.
- `api` - Openclaw RAG Express API used by the CoreBiz RAG screen.
- `jnac info_Assist/jnac-admin-chat` - JNAC Admin Chat Next.js app with Supabase Auth, product/price search, chat history, and sheet sync.
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

For this phase, CoreBiz Center is the central repo and navigation shell, while `jnac-admin-chat` remains a standalone module. Do not move its Next.js API routes, Supabase logic, auth flow, or sync logic into CoreBiz yet.

The next integration step should be a thin link or module entry from CoreBiz navigation to the JNAC Admin Chat app. After that is stable, shared auth, shared Supabase schema, and API consolidation can be planned as separate migrations.

## Environment

Keep app-specific environment variables in each app's local environment files or deployment settings. Do not commit `.env`, `.env.local`, Vercel metadata, `.next`, `dist`, or `node_modules`.

Openclaw RAG API local env variables are documented in `api/.env.example`:

- `OPENCLAW_SUPABASE_URL`
- `OPENCLAW_SUPABASE_ANON_KEY`
- `PHAYA_API_KEY`

## Vercel Deployment

This repo deploys to two separate Vercel projects:

- CoreBiz Center: `corebiz-center`, root directory `frontend`, production URL `https://www.corebiz.online`
- JNAC Admin Chat: `jnac-admin-chat`, root directory `jnac info_Assist/jnac-admin-chat`, production URL `https://jnac-admin-chat.vercel.app`

GitHub Actions deploys both projects from `.github/workflows/deploy.yml`. Required GitHub repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_COREBIZ_PROJECT_ID` or the legacy `VERCEL_PROJECT_ID`
- `VERCEL_JNAC_ADMIN_CHAT_PROJECT_ID`

Current Vercel project ids from the linked local workspace:

- `corebiz-center`: `prj_RgkMC07bPnjK0v9RH1491PC0yMKa`
- `jnac-admin-chat`: `prj_1uBZQXXhEAWB7XpH9Wz7ph8dBaFK`
