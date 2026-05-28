-- 0013_keyword_synonyms.sql
-- Replace per-product product_synonyms (migration 0012) with admin-friendly
-- keyword_synonyms — category-level term rewriting managed via the RAG
-- Knowledge Base UI. Admin enters one canonical word ("จานทราย") plus a
-- list of aliases ("จานทรายซ้อน", "ใบทรายซ้อน", ...). rag-chat rewrites
-- customer queries that mention any alias to the canonical word before
-- running the ilike product search.

drop table if exists public.product_synonyms cascade;

-- Keep pg_trgm + products_name_th_trgm_idx + search_products_fuzzy
-- (still used by rag-chat for fuzzy "did you mean X?" fallback).

create table public.keyword_synonyms (
  id          uuid        primary key default gen_random_uuid(),
  canonical   text        not null,
  aliases     text[]      not null default '{}',
  notes       text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid        references auth.users on delete set null
);

create unique index keyword_synonyms_canonical_lower_idx
  on public.keyword_synonyms (lower(canonical));

create index keyword_synonyms_aliases_idx
  on public.keyword_synonyms using gin (aliases);

create or replace function public.touch_keyword_synonyms_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger keyword_synonyms_set_updated_at
  before update on public.keyword_synonyms
  for each row execute function public.touch_keyword_synonyms_updated_at();

alter table public.keyword_synonyms enable row level security;

create policy "staff_manage_keyword_synonyms" on public.keyword_synonyms
  for all to authenticated
  using (is_staff())
  with check (is_staff());

create policy "public_read_keyword_synonyms" on public.keyword_synonyms
  for select to anon, authenticated
  using (true);
