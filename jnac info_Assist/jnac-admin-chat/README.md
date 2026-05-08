# JNAC Admin Chat

Admin-only web chat for JNAC product, price, stock, and website knowledge.

## Stack

- Next.js App Router
- Vercel deployment
- Supabase Auth + Postgres
- OpenAI Responses API
- Google Sheet sync endpoint for a 15-minute external cron

## Admin emails

- `supanrattanakool@gmail.com`
- `sinsupan49@gmail.com`
- `jnac.co.th@gmail.com`

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in Supabase SQL Editor.
3. Copy `.env.example` to `.env.local`.
4. Fill Supabase and OpenAI keys.
5. Run:

```bash
npm run dev
```

If Supabase env vars are empty, local development uses a dev-cookie login for whitelisted admin emails and reads fallback JSONL files from the parent workspace.

## Production env vars

Set these in Vercel:

```env
NEXT_PUBLIC_SUPABASE_URL=https://froaslmuvhirqvwmagln.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_TrGp72_EgM4lyq5TZBrvAA__kC5Uv-t
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
ADMIN_EMAILS=supanrattanakool@gmail.com,sinsupan49@gmail.com,jnac.co.th@gmail.com
GOOGLE_SHEET_ID=1c3U81eazLDTMQTdDScObASikKgYJf_qmKabn4Lyf1Og
INVENTORY_SHEET=Inventory
FLOWACCOUNT_SHEET=รหัส FlowAccount
PRODUCT_PRICE_GID=0
CRON_SECRET=
```

## Data rules

- Price answers come from Sheet `Product` / `gid=0`, matched by product name and `#` grit.
- Stock answers come from Sheet `Inventory`.
- Product code and description come from Sheet `รหัส FlowAccount`.
- Image columns are ignored.
- Chat sessions and messages are stored in `chat_sessions` and `chat_messages`.

## 15-minute sync

The app exposes:

```text
POST /api/sync
```

Vercel Hobby does not allow cron jobs every 15 minutes. Use one of these:

- Upgrade Vercel to Pro, then add `vercel.json` with schedule `*/15 * * * *`.
- Keep Hobby and call `/api/sync` every 15 minutes from an external cron service.
