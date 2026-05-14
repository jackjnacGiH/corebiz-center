-- =========================================================================
-- 0004_fix_embedding_dimension_4096.sql
--
-- Phaya embedding API returns vector(4096), not vector(1024) as
-- assumed in 0001_initial_schema.sql. This migration:
--   1. Drops the HNSW index (HNSW max 2000 dim for `vector` type)
--   2. Re-types embedding column to vector(4096)
--   3. Recreates match_knowledge() with vector(4096) signature
--
-- IMPORTANT: No ANN index is created for 4096-dim vectors. Cosine
-- similarity uses sequential scan, which is fine for < 10k rows.
-- If knowledge_chunks grows beyond that, options:
--   - Truncate to halfvec(2000) with HNSW (loses some quality)
--   - Switch to a smaller embedding model (OpenAI 3-small = 1536 dim)
--   - Use IVFFlat with halfvec (different limits)
-- =========================================================================

drop index if exists public.knowledge_chunks_embedding_idx;
drop function if exists public.match_knowledge(vector, float, int, text, text);

alter table public.knowledge_chunks
  alter column embedding type vector(4096) using embedding::vector(4096);

create or replace function public.match_knowledge(
  query_embedding   vector(4096),
  match_threshold   float default 0.65,
  match_count       int default 5,
  filter_language   text default null,
  filter_visibility text default 'public'
)
returns table (
  id          uuid,
  title       text,
  content     text,
  source_path text,
  metadata    jsonb,
  tags        text[],
  similarity  float
)
language sql
stable
set search_path = public
as $$
  select
    kc.id,
    kc.title,
    kc.content,
    kc.source_path,
    kc.metadata,
    kc.tags,
    1 - (kc.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks kc
  where kc.embedding is not null
    and (filter_language is null or kc.language = filter_language)
    and (filter_visibility is null or kc.visibility = filter_visibility)
    and 1 - (kc.embedding <=> query_embedding) > match_threshold
  order by kc.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_knowledge(vector, float, int, text, text) from public, anon;
grant execute on function public.match_knowledge(vector, float, int, text, text) to authenticated;
