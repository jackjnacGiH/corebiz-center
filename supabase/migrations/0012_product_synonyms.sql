-- 0012_product_synonyms.sql
-- Plan A: admin-managed synonym table for product search in rag-chat
-- Plan C: pg_trgm fuzzy search → clarification bubbles when no exact match
--
-- After applying:
--   • Add synonyms via Supabase Dashboard → Table Editor → product_synonyms
--   • rag-chat v21 resolves synonyms before vector search
--   • When 0 results + fuzzy candidates exist → widget shows choice bubbles

-- ─── Extension ──────────────────────────────────────────────────────────────
create extension if not exists pg_trgm;

-- GIN index on products.name_th for fast trigram similarity queries
create index if not exists products_name_th_trgm_idx
  on public.products using gin (name_th gin_trgm_ops);

-- ─── Synonym table ───────────────────────────────────────────────────────────
create table if not exists public.product_synonyms (
  id          uuid        primary key default gen_random_uuid(),
  product_id  uuid        not null references public.products on delete cascade,
  synonym     text        not null,
  created_at  timestamptz not null default now(),
  constraint product_synonyms_unique_lower unique (product_id, (lower(synonym)))
);

-- Fast exact-match lookup used by rag-chat
create index if not exists product_synonyms_lower_idx
  on public.product_synonyms (lower(synonym));

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.product_synonyms enable row level security;

create policy "staff_manage_synonyms" on public.product_synonyms
  for all to authenticated
  using (is_staff())
  with check (is_staff());

-- Public read so the admin UI can display synonyms without needing staff role
create policy "public_read_synonyms" on public.product_synonyms
  for select to anon, authenticated
  using (true);

-- ─── Fuzzy search RPC ────────────────────────────────────────────────────────
-- Called by rag-chat when normal ilike search returns 0 products.
-- Returns up to p_limit products whose name_th is trigram-similar to p_query.
create or replace function public.search_products_fuzzy(
  p_query     text,
  p_limit     int   default 3,
  p_threshold float default 0.2
)
returns table (
  product_id uuid,
  sku        text,
  name_th    text,
  name_en    text,
  sim        float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id                             as product_id,
    p.sku,
    p.name_th,
    p.name_en,
    similarity(p.name_th, p_query)   as sim
  from public.products p
  where p.status = 'active'
    and similarity(p.name_th, p_query) > p_threshold
  order by sim desc
  limit p_limit;
$$;

grant execute on function public.search_products_fuzzy to anon, authenticated;
