# CoreBiz Center — Project Standards & Developer Guide

> **Audience:** AI coding assistants (and humans) contributing to this repo.
> **Purpose:** Align with the existing architecture, follow established conventions, and **prevent regressions**. Read the "Golden Rules" first — most past incidents trace back to violating one of them.
>
> CoreBiz Center is the unified commerce platform for **JNAC (Thailand)** — an abrasives/industrial-supplies B2B business. Storefront, inventory, orders, CRM, omni-channel chat, an AI sales bot, marketing, and a knowledge base, all in one monorepo. The product language is **Thai-first** (UI is bilingual TH/EN).

---

## 0. Golden Rules (read before editing)

These encode real incidents. Violating them has caused outages or data issues before.

1. **Edge functions drift from the repo.** The *deployed* Supabase edge functions can be **newer** than the copies in `supabase/functions/`. **Before redeploying any edge function, fetch the live source first** (`get_edge_function`) and edit *that*, or you will silently revert deployed fixes. After deploying, sync the repo copy.
2. **Migrations are immutable once applied.** Never edit an applied migration. Always add a new `NNNN_name.sql` (next zero-padded number) and apply it. Triggers/functions use `create or replace` + `drop … if exists` so re-runs are idempotent.
3. **Deploy = push to `main`.** Vercel Git integration auto-deploys all services on push to `main`. There is **no lint gate** (the GitHub Action lint is pre-existing-RED but harmless). Don't block on it.
4. **Verify deploys by content, not by hash.** Local build chunk hashes differ from Vercel's (CRLF vs LF line endings). To confirm a deploy is live, poll the live JS chunk for a **marker string** you added, not a hash match.
5. **PostgREST caps single requests at 1000 rows.** Any full-table read must paginate with `.range()` + a **stable secondary sort** (e.g. `.order('id')`) to avoid skipped/duplicated rows.
6. **LINE limits:** the OA **cannot push file/document messages** (text/image/sticker/flex/template only). The **push** API has a monthly quota (free plan = 300/mo); the **reply** API (responding to an inbound message) is **free**. Prefer reply over push; deliver documents as **links**, not files. (See §6.)
7. **Never expose cost/margin/buying price** to customers or the bot, and **never echo channel secrets/tokens**. Entering credentials (LINE console, Supabase dashboard) is the operator's job, not the assistant's.
8. **Confirm before destructive/irreversible actions** (deleting data, mass operations). Use safe, explicit filters.

---

## 1. Project Architecture & Structure

### 1.1 Monorepo (npm workspaces)

Root `package.json` declares **npm workspaces** (not pnpm/yarn):

```json
"workspaces": ["frontend", "api", "apps/jnac-admin-chat"]
```

| Path | What it is | Stack | Served at |
|---|---|---|---|
| `frontend/` | Back-office **admin** shell | **Vite + React 19 + React Router 7** (SPA) | `/center` |
| `apps/storefront/` | Public **e-commerce** site (jnac.co.th) | **Next.js 16 (App Router) + React 19** | `/` |
| `apps/jnac-admin-chat/` | JNAC **admin chat** app | **Next.js 16 (App Router)** + `@supabase/ssr` | `/jnac` |
| `api/` | **Openclaw RAG API** (knowledge ingestion/search) | **Express 4** (`server.js`, port 3001) | standalone service |
| `supabase/` | Migrations + Edge Functions | Postgres + Deno edge runtime | Supabase project `owoedccmuqnzdtxvywgt` |

> Note: `apps/storefront` is deployed as its own Vercel service but is **not** in the root `workspaces` array; the three workspace entries are `frontend`, `api`, `apps/jnac-admin-chat`.

Useful root scripts: `dev:corebiz` / `build:corebiz` (→ `frontend`), `dev:jnac` / `build:jnac` (→ jnac-admin-chat), `start:api` (→ Express). `build` runs corebiz + jnac.

### 1.2 Vercel routing (`vercel.json`)

Uses Vercel **`experimentalServices`** (multi-framework single deployment):

```json
{
  "experimentalServices": {
    "corebiz": { "entrypoint": "frontend",               "routePrefix": "/center", "framework": "vite" },
    "jnac":    { "entrypoint": "apps/jnac-admin-chat",    "routePrefix": "/jnac",   "framework": "nextjs" },
    "shop":    { "entrypoint": "apps/storefront",         "routePrefix": "/",       "framework": "nextjs" }
  }
}
```

- **`/`** → storefront (Next). `basePath` via `SHOP_BASE_PATH`. The storefront `next.config.ts` **redirects** `/widget`, `/survey/*`, `/refer/*` → `/center/*` (so those public flows live in the Vite app).
- **`/center`** → Vite admin SPA. `vite.config.ts` sets `base: '/center/'`; React Router uses `basename="/center"`.
- **`/jnac`** → Next admin chat. `basePath` via `JNAC_BASE_PATH` (default `/jnac`).

### 1.3 How the Openclaw RAG API (`api/`) fits

There are **two distinct RAG paths** — keep them straight:

| | (a) Openclaw admin ingestion | (b) Customer chatbot |
|---|---|---|
| Where | `api/server.js` (Express, :3001) | `supabase/functions/rag-chat` (Deno edge) |
| Endpoints/entry | `POST /api/upload`, `/api/links`, `/api/search` | invoked via `knowledgeChatApi.askStream` / LINE webhook |
| Embeddings | **Phaya API** (`https://api.phaya.io/api/v1/embedding/create`) | LLM = **Gemini 2.5 Flash**; vector search via `match_knowledge` RPC |
| Vector store | `page_sections` table | `knowledge_chunks` table |
| Consumer | admin knowledge tooling | web widget (`/widget`) + LINE OA auto-reply |

> ⚠️ **Verify before relying on embedding specifics.** The Express service definitively uses **Phaya** → `page_sections`. The customer bot uses **Gemini** for generation and `match_knowledge` over `knowledge_chunks`; the exact embedding model used to populate `knowledge_chunks` should be confirmed in the deployed code before changing it (do **not** assume it matches Phaya or any specific OpenAI model). The admin **OpenclawRAG** page manages the knowledge base; confirm which store/edge-function it writes to in the live code before modifying.

---

## 2. Tech Stack, Tools & Libraries

**Frontend (admin `/center`):** Vite 7, React 19, React Router 7, TypeScript, Tailwind **v4**, **shadcn/ui** (style "new-york", base color "neutral"), Radix UI, `lucide-react` icons, `recharts`, `@react-pdf/renderer`, `@supabase/supabase-js`.

**Storefront & jnac-admin-chat:** Next.js 16 (App Router), React 19, Tailwind v4 (`@tailwindcss/postcss`), `@supabase/supabase-js`; jnac-admin-chat also uses `@supabase/ssr`.

**Backend:** Supabase (Postgres + PostgREST + Auth + Realtime + Storage), Deno **Edge Functions**, `pg_net` (HTTP from triggers), `pg_cron` (scheduled jobs), `pgvector` (RAG).

**Standalone API:** Express 4 (`api/`, "openclaw-rag-api"), `multer` (uploads), `cors`.

**Key external APIs / integrations:**
- **Phaya Embedding API** — RAG embeddings for the Openclaw ingestion service.
- **Google Gemini** (2.5 Flash / Flash-Lite) — the customer chatbot LLM (`rag-chat`).
- **LINE Messaging API** — OA inbound webhook + reply/push; channel token in `line_channels`.
- **Google Sheets** — hourly inventory stock sync.
- **Facebook / Messenger, Email, WhatsApp, Instagram** — channels are modeled in `chat_conversations.channel` and the Omni-Chat filters, but only **LINE + livechat (web widget)** are fully wired today; the rest are placeholders for future work.

**Tooling:** ESLint, TypeScript `tsc -b` before Vite build. Auth uses Supabase **PKCE** flow.

---

## 3. Coding Standards, Principles & Conventions

### 3.1 TypeScript / JavaScript
- **Function components + hooks** only. No class components.
- TypeScript throughout the Vite app and Next apps; `interface` for object shapes, `type` for unions/primitives.
- Supabase calls always unwrap the result tuple and **throw on error**:
  ```ts
  const { data, error } = await supabase.from('products').select('*');
  if (error) throw error;
  return data ?? [];
  ```
- **Generated DB types** live in `frontend/src/lib/database.types.ts`. When a table/RPC isn't in the generated types yet (e.g. a brand-new view or `create_or_replace function`), use the **untyped escape hatch** — `const db = supabase as any;` — and add a short comment. Regenerate types when convenient; don't fight the generator by hand-editing relations.
- **Thai user-facing strings** are normal in code (errors, toasts, labels). Keep them.

### 3.2 Data layer (`frontend/src/lib/api.ts`)
- One large module of exported namespace objects: `productsApi`, `customersApi`, `ordersApi`, `quoteRecordApi`, `chatInboxApi`, `tierApi`, `surveyApi`, `customerProfileApi`, `reorderApi`, `winbackApi`, `quoteFollowupApi`, `referralApi`, `loyaltyApi`, `knowledgeAdminApi`, `knowledgeChatApi`, etc.
- **Paginate full-table reads** (Golden Rule #5):
  ```ts
  const PAGE = 1000; const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('customers').select('*')
      .order('total_spent', { ascending: false }).order('id', { ascending: true }) // stable tiebreaker
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data ?? [])); if ((data ?? []).length < PAGE) break;
  }
  ```
- Bulk operations report partial failures clearly (e.g. `Promise.allSettled` + a Thai error summarizing `N/total` failed).

### 3.3 State, caching & realtime
- **Stale-while-revalidate** via `lib/cache.ts` (no external lib): `swrList(key, fetcher, { force, onFresh })` returns the cached copy instantly and revalidates in the background, pushing fresh data through `onFresh`. Cache keys are centralized in `CK` (e.g. `CK.products`). `prefetchList()` warms caches ~1.2s after the shell mounts; `invalidateList()` after writes; `hasCache()` skips the cold spinner.
- **Realtime:** `lib/useRealtimeTable.ts` subscribes to `postgres_changes` on a table and calls `onChange()`. Used by Omni-Chat (messages/conversations) and list pages.
- Don't introduce Redux/Zustand/React-Query — match the existing SWR-map + context approach.

### 3.4 Auth & routing
- `lib/supabase.ts` creates the client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (PKCE, persisted sessions) and exports `AppRole`, `Profile`, `fetchProfile`.
- `lib/AuthProvider.tsx` loads session + profile and exposes `useAuth()`.
- `lib/ProtectedRoute.tsx` gates routes: `STAFF_ROLES = ['owner','admin','staff','agent','viewer']` reach `/center`; **customers are redirected to `/account`** (the storefront portal). Pass `roles={['owner','admin']}` to restrict a route further (Settings, Users, AI Agent, Audit).
- **Every page is code-split** with `React.lazy` + a single `<Suspense>` fallback in `App.tsx`. Add new pages the same way. Public routes (`/login`, `/auth/*`, `/widget`, `/survey/:token`, `/q/:token`, `/refer/:code`) sit **outside** the `ProtectedRoute` parent.

### 3.5 i18n
- `LanguageProvider` + `i18n.ts` provide a flat TH/EN dictionary; access via `const { t } = useLanguage()` → `t.section.key`. Default language **Thai**, persisted in `localStorage`. Add new strings to **both** `th` and `en`.

### 3.6 Components & styling
- Feature components live under `frontend/src/components/<feature>/` (e.g. `components/chat/*`, `components/layout/*`); shadcn primitives in `components/ui/*`. Files are **PascalCase**.
- Use `cn()` from `@/lib/utils` (clsx + tailwind-merge) for conditional classes. Import the `@/components/ui/*` primitives and `lucide-react` icons.
- **Tailwind v4 — there is NO `tailwind.config`.** The theme/tokens live in `frontend/src/index.css` via `@theme inline` + CSS variables. Brand palette is **Indigo** (`--primary-500: #6366F1`). Use `tabular-nums` for money, `whitespace-pre-wrap` for chat. Reuse the existing CSS variables/semantic aliases rather than hardcoding new hex values.
- **PDF pitfall:** `@react-pdf/renderer`'s `<PDFViewer>` (iframe) renders **blank** on mobile / inside collapsed flex containers. For on-screen quote/document views, render **HTML** (the shared `QuoteDocument` component) and offer the PDF via **download or print** (`lib/print.ts` → `printElement`). Lazy-load the heavy `@react-pdf` bundle only on the download action.

---

## 4. Database & Backend Architecture (Supabase)

### 4.1 Migrations
- Location `supabase/migrations/`, named `NNNN_descriptive_name.sql` (zero-padded, sequential, **no gaps** — currently `0001`…`0070`).
- Each starts with a **header comment block** explaining purpose + notable caveats.
- Raw SQL only. Functions: `create or replace function …`. Triggers: `drop trigger if exists …; create trigger …` (idempotent). Tables: `create table if not exists` + `alter table … enable row level security`.
- Apply via the Supabase MCP/CLI; **never edit an applied file** (Golden Rule #2).

### 4.2 RBAC roles
Stored in `profiles.role` (CHECK constraint): **`owner`, `admin`, `staff`, `agent`, `customer`, `viewer`** + `is_active` flag.
- `owner` — everything, incl. user management + ownership transfer.
- `admin` — full data + user management + settings + AI Agent + audit.
- `staff` — read/write CRM/sales data; **no** user management; **no** delete on core entities.
- `agent` / `viewer` — read-only (agent additionally works the AI-Agent task queue).
- `customer` — storefront + `/account` portal only; **never** reaches `/center`.

### 4.3 RLS patterns
Helper functions (SQL, `stable security definer`, check role + `is_active`):

```sql
create or replace function public.is_staff() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and p.role in ('owner','admin','staff')); $$;
```
Also `is_owner()`, `can_write()` (owner/admin/staff), `can_delete()` (owner/admin only).

Representative policies:
- **Staff full access** (most tables): `for all to authenticated using (is_staff()) with check (is_staff())`.
- **Public read** (storefront): `for select to anon using (status = 'active')`.
- **Restrictive delete** (core entities): `as restrictive for delete to authenticated using (can_delete())`.
- **Self-only** (profiles): row owner `id = auth.uid()` (+ a self-update check that the role can't be changed by the user).
- **Public writes happen only through anon RPCs** (never direct anon table writes) — surveys, referrals, storefront quotes.

### 4.4 Anon-callable RPC convention (`SECURITY DEFINER`)
For any endpoint a logged-out visitor must call (public quote viewer, survey submit, referral signup), the function is `security definer` and grants are tightened explicitly:

```sql
revoke execute on function public.get_quote_by_token(uuid) from public;
grant  execute on function public.get_quote_by_token(uuid) to anon, authenticated;
```
Identity for these is a **secret token** (UUID), not auth — same model as survey/referral links. Staff-only RPCs are gated by `is_staff()` inside the function and granted only to `authenticated` (anon/public revoked) so token-less calls can't even appear in logs.

### 4.5 Key triggers & functions (don't duplicate; extend these)
- **Stock** — `tg_order_status_inventory()` on `orders` (after update of `status`): decrements `inventory.quantity` + logs `inventory_movements` when status enters `processing/shipped/delivered`; restores on `cancelled/returned`. **Skips line items with `product_id IS NULL`** (custom/shipping lines never touch stock).
- **Loyalty / tiers** — `tier_benefits` config table (per-tier multiplier, discount %, min spend); `grant_purchase_points` / `adjust_loyalty_points` / `redeem_loyalty_points` RPCs; `apply_customer_tier` recomputes a customer's tier from `total_spent`; `customer_benefits` view joins the two.
- **Quote automation** — `tg_send_quote_link()` (on `agent_tasks`, kind `sales.quote_request`): auto-links the quote to the conversation's CRM customer + drops the public link into chat; `apply_quote_shipping()` appends the `ค่าจัดส่งสินค้า` line (`sku='SHIPPING'`, `product_id=null`, default ฿100) and recomputes totals (idempotent); `tg_agent_task_shipping()` calls it for every bot quote (LINE + web).
- **Notifications** — `notify_team_on_agent_task()` POSTs to the `notify-team` edge function via `pg_net` (shared-key header). **Currently DISABLED** (`trg_notify_team` disabled in migration 0067) to conserve LINE push quota; re-enable only after a plan upgrade.
- **Customer portal** — `my_customer_id()`, `my_orders()`, `my_quotes()`, `respond_my_quote()` etc.: security-definer RPCs scoped to the **verified** link (`customers.user_id = auth.uid()`); unverified links return null.

---

## 5. Core Modules & Code Flow

UI → `lib/api.ts` (or an edge function) → Supabase → (realtime/trigger) → UI. Page files are in `frontend/src/pages/`.

### 5.1 Inventory (`pages/Inventory.tsx`)
- Loads via `productsApi.list()` which **joins products + inventory + categories + groups** and derives `total_quantity`, `low_stock`, `last_synced_at`.
- Stock **status** (out/low/watch/normal) is computed in the UI from quantity + reorder level.
- Manual stock edits go through `inventoryApi` (writes `inventory.quantity`). **Order-driven stock changes are NOT done here** — they come from the `tg_order_status_inventory` trigger.
- Hourly **Google Sheet sync** is fired by `inventorySyncApi.triggerManual()` (RPC → async edge job) with status polled from `inventory_sync_logs`. SWR-cached + realtime on `products`/`inventory`.

### 5.2 Orders (`pages/Orders.tsx`)
- `ordersApi.list()` (orders + customer + item count); detail via `ordersApi.getById()`.
- `ordersApi.updateStatus()` writes `orders.status` → fires inventory (and loyalty) triggers.
- **Quote → Order:** `quoteRecordApi.approveAsOrder(quoteId)` is a deliberate **client-side 5-step sequence** (idempotent: re-running returns the existing order) — load quote/items, create `orders` (code `QT-…` → `SO-…`, status `processing`), mirror `quote_items` → `order_items`, link `quotes.converted_to_order_id`.
- Documents print via the shared **`QuoteDocument`** HTML + `printElement` (Save-as-PDF). The doc title changes with status (ใบเสนอราคา / ใบสั่งขาย / ใบส่งของ …).

### 5.3 CRM (`pages/CRM.tsx`)
- Tabbed: Dashboard (`crmDashboardApi.stats`), Customer list (`customersApi.list/search`, paginated), **RFM** (`customer_rfm` view via untyped client), and tools: reorder, win-back, quote-followup, **NPS/survey**, referral, **tier management**, campaign, schedule.
- **Customer 360°:** `customerProfileApi.get()` runs a parallel bundle (customer + RFM + orders + quotes + loyalty + chats + branches).
- **Account-link approval:** customers self-register (tax ID); staff (owner/admin) approve/reject the link via RPC, after which the portal shows tier + history. Outreach tools (reorder/win-back/etc.) send through `chatInboxApi.sendMessage` (LINE) and therefore consume push quota — they're operator-triggered.

### 5.4 Omni-Chat (`pages/Chat.tsx`) & Web Widget (`pages/CustomerChat.tsx`)
- **Admin inbox:** `chatInboxApi.listConversations()` (channel/status/search filters; note-search via `search_note_conversation_ids` RPC; company name enriched from `chat_contact_notes`). Messages via `chatInboxApi.listMessages()`; realtime subscriptions on `chat_conversations` + `chat_messages`.
- **Sending:** `chatInboxApi.sendMessage()` inserts a `chat_messages` row and, for LINE, calls the **`line-push`** edge function (best-effort; flags `line_push_failed` in metadata if the quota is hit). Supports **reply-to-message** (stores `metadata.reply_to`; forwards the inbound message's `quote_token` so LINE shows a native quoted reply). "อ่านแล้วทั้งหมด" = `chatInboxApi.markAllRead()` (bulk `unread_count = 0`).
- **Bot pipeline (LINE):** customer message → **`line-webhook`** (saves message, downloads images/files to the `chat-attachments` bucket, auto-links the chat to a CRM customer) → calls **`rag-chat`** → replies via the LINE **reply** API. The bot also **auto-creates draft quotes** (`request_quote` tool) and the public quote link is sent **in the same free reply** (not a push — see §6).
- **Web widget** (`CustomerChat.tsx`, served at `/widget`, iframed onto jnac.co.th): calls `rag-chat` directly with a per-visitor `sessionId`; the conversation is persisted as a `livechat` channel so staff see it in the inbox and can reply live (realtime).

### 5.5 Knowledge / RAG (`pages/OpenclawRAG.tsx`, `pages/KnowledgeChat.tsx`)
- **OpenclawRAG** = admin knowledge-base management (sources, chunks, categories, keyword synonyms) + a test-search tab. **KnowledgeChat** = staff Q&A against the knowledge base (separate from the customer-facing bot).
- Two stores exist (see §1.3): the legacy **Express `api/` + Phaya → `page_sections`**, and the Supabase **`knowledge_chunks`** queried by `match_knowledge` and used by `rag-chat`. **Confirm in live code which store the admin page writes to and which embedding model populates `knowledge_chunks` before changing RAG ingestion.**
- The customer bot enforces hardcoded safety rules (no cost/margin, no fabrication, always "own it" + `capture_lead` when unsure, treat `QT-/SO-/DN-` as document numbers not SKUs) and matches the customer's language.

---

## 6. LINE / Messaging Operational Notes (high-incident area)

- **File push is impossible** on LINE OA. Customer-sent files are downloaded by `line-webhook` into the `chat-attachments` bucket and shown as cards; admin-sent files/quotes are delivered as **links**.
- **Push quota (free plan = 300/mo)** is the main bottleneck. The **reply** API is free and unlimited (within the reply window). Therefore:
  - The bot's answer **and** the public quote link both go out in the **single free reply** (`line-webhook` v20+). Don't move them back to `push`.
  - The bot's auto-reply never costs quota; only admin Omni-Chat replies and CRM outreach (campaigns/reminders/surveys) consume push.
  - Team notifications into LINE are **disabled** (migration 0067) to preserve quota.
- The obsolete "บัญชีของฉัน / `/account`" login pointer is **stripped** from bot replies (`sanitizeReply`) and the web-widget render — quotes are viewed via the public `/center/q/<token>` link (no login). Don't reintroduce the `/account` pointer for quotes.

---

## 7. Deploy & Verify Checklist

1. **Frontend / Next apps:** commit → push `main` → Vercel auto-deploys. Verify by polling the live JS chunk for a **marker string** (not a hash).
2. **Migrations:** add `NNNN_name.sql`, apply via Supabase, commit the file.
3. **Edge functions:** **fetch the live source first**, edit, deploy (set `verify_jwt` appropriately — webhooks/key-gated functions use `verify_jwt:false`), then commit the synced repo copy. Functions run with the **service-role key**.
4. Keep `memory/` (assistant working memory) and this file updated when a convention changes.

---

*Generated from a deep read of the repo. Where a detail couldn't be 100% confirmed from source (noted with ⚠️), verify against live code before depending on it — don't invent specifics.*
