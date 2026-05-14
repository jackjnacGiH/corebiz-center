-- =========================================================================
-- 0003_enable_rls_page_sections.sql
-- The legacy `page_sections` table (used by Openclaw RAG Express server,
-- api/server.js) was created without RLS. It contains 325 rows of vector
-- data. We don't want to drop it, but we must enable RLS to prevent anon
-- access. Service role (Openclaw API server) bypasses RLS for writes.
-- =========================================================================

alter table public.page_sections enable row level security;

create policy page_sections_staff_read on public.page_sections
  for select to authenticated using (public.is_staff());
